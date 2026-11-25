/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { lookup } from 'node:dns/promises';
import { Agent } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { AuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { parseCosmosDBConnectionString } from '../cosmosdb/cosmosDBConnectionStrings';
import { type CosmosDBCredential, getCosmosDBCredentials } from '../cosmosdb/CosmosDBCredential';
import { getCosmosClient, type GetCosmosClientOptions } from '../cosmosdb/getCosmosClient';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type CosmosDBAccountModel } from '../tree/cosmosdb/models/CosmosDBAccountModel';
import { type CosmosDBAttachedAccountModel } from '../tree/workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { classifyAccessError, getHttpFailure, matchesDeniedPrincipal } from './classify';
import { type CheckResult, type DiagnosticsState, type FailureStage, type NetworkSummary, type Step } from './model';
import { DiagnosticsRunTrace, reportDiagnosticsOutcome, sdkStage } from './runTrace';

export type AccountDiagnosticsTarget = (
    | { kind: 'azure'; account: CosmosDBAccountModel }
    | { kind: 'attached' | 'emulator'; account: CosmosDBAttachedAccountModel }
) & { probe: 'nosql' | 'network' };
export type DiagnosticsTarget =
    | AccountDiagnosticsTarget
    | { kind: 'queryEditor'; probe: 'query'; connection: NoSqlQueryConnection };

export type DiagnosticsAzureAccount = Pick<CosmosDBAccountModel, 'id' | 'name' | 'resourceGroup' | 'subscription'>;

export function getDiagnosticsAzureAccount(target: DiagnosticsTarget): DiagnosticsAzureAccount | undefined {
    if (target.kind === 'azure') return target.account;
    const metadata =
        target.kind === 'queryEditor' && !target.connection.isEmulator ? target.connection.azureMetadata : undefined;
    return (
        metadata && {
            id: metadata.accountId,
            name: metadata.accountName,
            resourceGroup: metadata.resourceGroup,
            subscription: metadata.subscription,
        }
    );
}

const containerProbe = 'SELECT TOP 1 VALUE 1 FROM c';

const authLabels = {
    [AuthenticationMethod.accountKey]: 'key',
    [AuthenticationMethod.entraId]: 'entra',
    [AuthenticationMethod.managedIdentity]: 'identity',
} as const satisfies Record<CosmosDBCredential['type'], NonNullable<CheckResult['auth']>>;

const PRIVATE_ADDRESSES = new BlockList();
for (const [address, prefix] of [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
] as const) {
    PRIVATE_ADDRESSES.addSubnet(address, prefix);
}
PRIVATE_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_ADDRESSES.addAddress('::1', 'ipv6');

class StepTimeoutError extends Error {}

async function bounded<T>(
    parent: AbortSignal,
    timeoutMs: number,
    operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    parent.throwIfAborted();
    const deadline = new AbortController();
    const signal = AbortSignal.any([parent, deadline.signal]);
    const timer = setTimeout(() => deadline.abort(new StepTimeoutError()), timeoutMs);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
            const reason: unknown = signal.reason;
            reject(reason instanceof Error ? reason : new Error('Diagnostics cancelled'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([aborted, operation(signal)]);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}

function validEndpoint(value: unknown, emulator: boolean): URL | undefined {
    if (typeof value !== 'string') return undefined;
    const url = URL.parse(value);
    if (
        !url ||
        (url.protocol !== 'https:' && !(emulator && url.protocol === 'http:')) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
    ) {
        return undefined;
    }
    return url;
}

function summarizeNetwork(account: DatabaseAccountGetResults): NetworkSummary {
    const mode = account.publicNetworkAccess;
    return {
        publicAccess:
            mode === 'Enabled'
                ? 'enabled'
                : mode === 'Disabled'
                  ? 'disabled'
                  : mode === 'SecuredByPerimeter'
                    ? 'securedByPerimeter'
                    : 'unknown',
        ipRules: account.ipRules?.length ?? 0,
        vnetFilterEnabled: account.isVirtualNetworkFilterEnabled === true,
        vnetRules: account.virtualNetworkRules?.length ?? 0,
        privateEndpoints: account.privateEndpointConnections?.length ?? 0,
        localAuthDisabled: account.disableLocalAuth === true,
    };
}

function shouldCheckDnsAfterAccess(checks: readonly CheckResult[]): boolean {
    const access =
        checks.find(({ step, status }) => step === 'query' && status !== 'skipped') ??
        checks.find(({ step }) => step === 'access');
    switch (access?.finding) {
        case 'dnsFailure':
        case 'transportFailure':
        case 'connectionRefused':
        case 'connectionReset':
        case 'connectionTimedOut':
        case 'timedOut':
        case 'firewallPrivateEndpoint':
            return true;
        case 'firewallPublic':
        case 'firewallServiceEndpoint':
        case 'firewallUnknown':
        case 'forbiddenUnknown': {
            const network = checks.find(({ step }) => step === 'accountSettings')?.network;
            // The SDK reached the service. DNS only adds a clue if private routing may be relevant.
            return network !== undefined && (network.publicAccess === 'disabled' || network.privateEndpoints > 0);
        }
        default:
            return false;
    }
}

async function readArmAccount(account: DiagnosticsAzureAccount, signal: AbortSignal) {
    return callWithTelemetryAndErrorHandling('cosmosDB.diagnostics.readAccount', async (context) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.maskEntireErrorMessage = true;
        context.telemetry.suppressIfSuccessful = true;
        const group = account.resourceGroup;
        if (!group) return undefined;
        context.valuesToMask.push(account.id, account.name, group, account.subscription.subscriptionId);
        const client = await createCosmosDBManagementClient(context, account.subscription);
        signal.throwIfAborted();
        const resource = await client.databaseAccounts.get(group, account.name, { abortSignal: signal });
        return { databaseAccount: resource, resourceGroup: group, getClient: async () => client };
    });
}

export async function runDiagnostics(
    target: DiagnosticsTarget,
    parent: AbortSignal,
    publish: (state: DiagnosticsState) => void,
    onRbacPrincipal?: (principalId: string, account: DiagnosticsAzureAccount) => void,
): Promise<void> {
    const emulator = target.kind === 'emulator' || (target.kind === 'queryEditor' && target.connection.isEmulator);
    const azureAccount = getDiagnosticsAzureAccount(target);
    const kind = azureAccount ? 'azure' : emulator ? 'emulator' : target.kind;
    const scope = target.probe === 'query' ? 'container' : undefined;
    const trace = new DiagnosticsRunTrace(kind, target.probe);
    const checks: CheckResult[] = [];
    let active: Step = azureAccount ? 'accountSettings' : 'target';
    const begin = (step: Step) => {
        active = step;
        trace.recordChecks(checks);
        trace.begin(step);
        publish({ kind, scope, phase: 'running', active, checks: [...checks], trace: trace.snapshot() });
    };
    try {
        begin(active);
        parent.throwIfAborted();
        let arm: Awaited<ReturnType<typeof readArmAccount>>;
        let endpoint: string | undefined;
        let key: string | undefined;
        let tenantId: string | undefined;
        if (azureAccount) {
            if (target.kind === 'queryEditor') {
                endpoint = target.connection.endpoint;
            } else if (target.kind === 'azure') {
                const rawEndpoint: unknown = target.account.raw?.properties?.documentEndpoint;
                endpoint = typeof rawEndpoint === 'string' ? rawEndpoint : undefined;
                tenantId = target.account.subscription.tenantId;
            }
            try {
                arm = await bounded(parent, 6_000, (signal) => readArmAccount(azureAccount, signal));
                if (arm) {
                    if (target.kind === 'azure') endpoint = arm.databaseAccount.documentEndpoint ?? endpoint;
                    const network = summarizeNetwork(arm.databaseAccount);
                    checks.push({ step: 'accountSettings', finding: 'settingsRead', status: 'passed', network });
                } else {
                    checks.push({ step: 'accountSettings', finding: 'settingsUnavailable', status: 'info' });
                }
            } catch {
                parent.throwIfAborted();
                checks.push({ step: 'accountSettings', finding: 'settingsUnavailable', status: 'info' });
            }
            begin('target');
        } else if (target.kind === 'queryEditor') {
            endpoint = target.connection.endpoint;
            checks.push({ step: 'accountSettings', finding: 'settingsNotApplicable', status: 'skipped' });
        } else if (target.kind !== 'azure') {
            try {
                const parsed = parseCosmosDBConnectionString(target.account.connectionString);
                ({ documentEndpoint: endpoint, masterKey: key } = parsed);
                tenantId = target.account.tenantId ?? parsed.tenantId;
            } catch {
                // A malformed stored connection is reported by endpoint validation without exposing its input.
            }
            checks.push({ step: 'accountSettings', finding: 'settingsNotApplicable', status: 'skipped' });
        }

        const url = validEndpoint(endpoint, emulator);
        checks.unshift({
            step: 'target',
            finding: url ? 'endpointReady' : 'invalidEndpoint',
            status: url ? 'passed' : 'failed',
        });
        if (target.probe === 'network') {
            checks.push({ step: 'access', finding: 'apiProbeUnavailable', status: 'skipped' });
        }
        if (!url) return;

        if (target.probe !== 'network') {
            begin('access');
            let auth: CheckResult['auth'];
            let principalId: string | undefined;
            let stage: FailureStage = 'credentials';
            let lastRequest: FailureStage | undefined;
            let lastHttp: CheckResult['http'];
            const recordFailure = (error: unknown): CheckResult => {
                parent.throwIfAborted();
                const sdkHttp = getHttpFailure(error);
                const http =
                    sdkHttp && sdkHttp.status === lastHttp?.status && sdkHttp.substatus === undefined
                        ? lastHttp
                        : sdkHttp;
                const classification =
                    error instanceof StepTimeoutError
                        ? { finding: 'timedOut' as const }
                        : stage === 'query' && http?.status === 404 && lastRequest !== 'accountMetadata'
                          ? { finding: 'containerUnavailable' as const }
                          : classifyAccessError(error, http);
                const needsRole = classification.finding === 'dataRbac';
                const failureStage =
                    classification.finding === 'tokenUnavailable' || stage === 'credentials'
                        ? 'credentials'
                        : (lastRequest ?? stage);
                if (
                    needsRole &&
                    azureAccount &&
                    (target.kind !== 'queryEditor' || (stage !== 'query' && lastRequest === 'accountMetadata')) &&
                    validEndpoint(arm?.databaseAccount.documentEndpoint, false)?.origin === url.origin &&
                    principalId &&
                    auth !== 'key' &&
                    matchesDeniedPrincipal(error, principalId)
                ) {
                    onRbacPrincipal?.(principalId, azureAccount);
                }
                const result: CheckResult = {
                    step: stage === 'query' ? 'query' : 'access',
                    ...classification,
                    status: needsRole ? 'info' : 'failed',
                    ...(stage === 'query' ? {} : { auth }),
                    failureStage,
                    ...(http ? { http } : {}),
                };
                checks.push(result);
                return result;
            };
            const probeOptions = {
                onHttpRequest: (request) => {
                    lastRequest = sdkStage(request);
                    lastHttp = undefined;
                },
                onHttpResponse: (response) => {
                    trace.recordResponse(response, url);
                    lastRequest = sdkStage(response.request);
                    lastHttp = getHttpFailure({
                        statusCode: response.status,
                        substatus: response.headers.get('x-ms-substatus'),
                    });
                },
                connectionPolicy: {
                    enableBackgroundEndpointRefreshing: false,
                    retryOptions: { maxRetryAttemptCount: 0 },
                },
            } satisfies GetCosmosClientOptions;
            try {
                // Do not send cloud credentials to an emulator when its saved key is missing.
                const credentials =
                    target.kind === 'queryEditor'
                        ? target.connection.credentials
                        : emulator && !key
                          ? []
                          : await bounded(parent, 12_000, (abortSignal) =>
                                getCosmosDBCredentials(
                                    {
                                        accountName: target.account.name,
                                        documentEndpoint: url.href,
                                        isEmulator: emulator,
                                        arm,
                                        masterKey: key,
                                        tenantId,
                                    },
                                    { silent: true, abortSignal, keyProbeOptions: probeOptions },
                                ),
                            );
                if (!credentials.length) {
                    checks.push({
                        step: 'access',
                        finding: 'missingCredentials',
                        status: 'failed',
                        failureStage: stage,
                    });
                } else {
                    // The shared client accepts self-signed emulator certificates by default. Diagnostics must check trust.
                    const agent =
                        emulator && url.protocol === 'https:' ? new Agent({ rejectUnauthorized: true }) : undefined;
                    const clientOptions = {
                        ...probeOptions,
                        agent,
                        silentAuthentication: true,
                        onAuthenticationMethod: (method, oid) => {
                            auth = authLabels[method];
                            principalId = oid;
                        },
                    } satisfies GetCosmosClientOptions;
                    try {
                        const client =
                            target.kind === 'queryEditor'
                                ? getCosmosClient(target.connection, clientOptions)
                                : getCosmosClient(url.href, credentials, emulator, clientOptions);
                        try {
                            lastRequest = undefined;
                            lastHttp = undefined;
                            stage = 'listDatabases';
                            let listingFailure: CheckResult | undefined;
                            try {
                                await bounded(parent, 12_000, (abortSignal) =>
                                    client.databases.readAll({ maxItemCount: 1, abortSignal }).fetchNext(),
                                );
                                checks.push({ step: 'access', finding: 'connected', status: 'passed', auth });
                            } catch (error) {
                                listingFailure = recordFailure(error);
                            }
                            // A role scoped to one container may allow queries without permitting account-wide listing.
                            if (
                                target.kind === 'queryEditor' &&
                                (!listingFailure ||
                                    (listingFailure.finding === 'dataRbac' && lastRequest === 'listDatabases'))
                            ) {
                                begin('query');
                                stage = 'query';
                                lastRequest = undefined;
                                lastHttp = undefined;
                                const { databaseId, containerId } = target.connection;
                                await bounded(parent, 12_000, (abortSignal) =>
                                    client
                                        .database(databaseId)
                                        .container(containerId)
                                        .items.query(containerProbe, { maxItemCount: 1, abortSignal })
                                        .fetchNext(),
                                );
                                checks.push({ step: 'query', finding: 'querySucceeded', status: 'passed' });
                            }
                        } finally {
                            client.dispose();
                        }
                    } finally {
                        agent?.destroy();
                    }
                }
            } catch (error) {
                recordFailure(error);
            }
            if (target.probe === 'query' && !checks.some(({ step }) => step === 'query')) {
                checks.push({ step: 'query', finding: 'queryNotRun', status: 'skipped' });
            }
            if (!shouldCheckDnsAfterAccess(checks)) return;
        }

        begin('dns');
        try {
            const host = url.hostname.replace(/^\[|\]$/g, '');
            const family = isIP(host);
            const addresses = family
                ? [{ address: host, family }]
                : await bounded(parent, 3_000, () => lookup(host, { all: true }));
            const privateCount = addresses.filter(({ address, family }) =>
                PRIVATE_ADDRESSES.check(address, family === 6 ? 'ipv6' : 'ipv4'),
            ).length;
            const finding = !addresses.length
                ? 'unresolvedDns'
                : !privateCount
                  ? 'publicDns'
                  : privateCount === addresses.length
                    ? 'privateDns'
                    : 'mixedDns';
            checks.push({
                step: 'dns',
                finding,
                status: finding === 'publicDns' || finding === 'privateDns' ? 'passed' : 'info',
            });
        } catch {
            parent.throwIfAborted();
            checks.push({ step: 'dns', finding: 'unresolvedDns', status: 'info' });
        }
    } catch {
        if (!parent.aborted) checks.push({ step: active, finding: 'unexpected', status: 'failed' });
    } finally {
        trace.recordChecks(checks);
        const phase = parent.aborted ? 'cancelled' : 'completed';
        const durationMs = trace.complete(phase);
        const state: DiagnosticsState = {
            kind,
            scope,
            phase,
            finishedAt: Date.now(),
            checks: [...checks],
            trace: trace.snapshot(),
        };
        publish(state);
        await reportDiagnosticsOutcome(state, target.probe, durationMs);
    }
}
