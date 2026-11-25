/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { lookup } from 'node:dns/promises';
import { Agent } from 'node:https';
import { BlockList, isIP } from 'node:net';
import * as vscode from 'vscode';
import { AuthenticationMethod, getPreferredAuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { parseCosmosDBConnectionString } from '../cosmosdb/cosmosDBConnectionStrings';
import { type CosmosDBCredential } from '../cosmosdb/CosmosDBCredential';
import { getCosmosClient } from '../cosmosdb/getCosmosClient';
import { ext } from '../extensionVariables';
import { type CosmosDBAccountModel } from '../tree/cosmosdb/models/CosmosDBAccountModel';
import { type CosmosDBAttachedAccountModel } from '../tree/workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { classifyAccessError } from './classify';
import { type CheckResult, type DiagnosticsState, type NetworkSummary, type Step, type TargetKind } from './model';

export type DiagnosticsTarget = (
    | { kind: 'azure'; account: CosmosDBAccountModel }
    | { kind: 'attached' | 'emulator'; account: CosmosDBAttachedAccountModel }
) & { probe: 'nosql' | 'network' };

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

function validEndpoint(value: unknown, kind: TargetKind): URL | undefined {
    if (typeof value !== 'string') return undefined;
    const url = URL.parse(value);
    if (
        !url ||
        (url.protocol !== 'https:' && !(kind === 'emulator' && url.protocol === 'http:')) ||
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

async function readArmAccount(account: CosmosDBAccountModel, signal: AbortSignal) {
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
        return { client, resource };
    });
}

async function readArmKey(client: CosmosDBManagementClient, group: string, name: string, signal: AbortSignal) {
    try {
        const keys = await client.databaseAccounts.listReadOnlyKeys(group, name, { abortSignal: signal });
        return keys.primaryReadonlyMasterKey;
    } catch (error) {
        if (!error || typeof error !== 'object' || !('statusCode' in error) || error.statusCode !== 403) throw error;
        const keys = await client.databaseAccounts.listKeys(group, name, { abortSignal: signal });
        return keys.primaryMasterKey;
    }
}

export async function runDiagnostics(
    target: DiagnosticsTarget,
    parent: AbortSignal,
    publish: (state: DiagnosticsState) => void,
): Promise<void> {
    const checks: CheckResult[] = [];
    const update = (phase: DiagnosticsState['phase'], active?: Step) =>
        publish({ kind: target.kind, phase, active, checks: [...checks] });
    let active: Step = 'target';
    const begin = (step: Step) => {
        active = step;
        update('running', step);
    };
    try {
        begin('target');
        parent.throwIfAborted();
        const mode = target.probe === 'nosql' ? getPreferredAuthenticationMethod() : undefined;
        let endpoint: string | undefined;
        let key: string | undefined;
        let tenantId: string | undefined;
        if (target.kind === 'azure') {
            const rawEndpoint: unknown = target.account.raw?.properties?.documentEndpoint;
            endpoint = typeof rawEndpoint === 'string' ? rawEndpoint : undefined;
            tenantId = target.account.subscription.tenantId;
            begin('accountSettings');
            try {
                const arm = await bounded(parent, 6_000, (signal) => readArmAccount(target.account, signal));
                if (arm) {
                    endpoint = arm.resource.documentEndpoint ?? endpoint;
                    const network = summarizeNetwork(arm.resource);
                    checks.push({ step: 'accountSettings', finding: 'settingsRead', status: 'passed', network });
                    if (
                        !network.localAuthDisabled &&
                        target.account.resourceGroup &&
                        (mode === AuthenticationMethod.auto || mode === AuthenticationMethod.accountKey)
                    ) {
                        try {
                            const { resourceGroup, name } = target.account;
                            key = await bounded(parent, 5_000, (signal) =>
                                readArmKey(arm.client, resourceGroup, name, signal),
                            );
                        } catch {
                            parent.throwIfAborted();
                            // Key-only mode reports missing credentials below; automatic mode can still use Entra.
                        }
                    }
                } else {
                    checks.push({ step: 'accountSettings', finding: 'settingsUnavailable', status: 'info' });
                }
            } catch {
                parent.throwIfAborted();
                checks.push({ step: 'accountSettings', finding: 'settingsUnavailable', status: 'info' });
            }
        } else {
            try {
                const parsed = parseCosmosDBConnectionString(target.account.connectionString);
                ({ documentEndpoint: endpoint, masterKey: key } = parsed);
                tenantId = target.account.tenantId ?? parsed.tenantId;
            } catch {
                // A malformed stored connection is reported by endpoint validation without exposing its input.
            }
            checks.push({ step: 'accountSettings', finding: 'settingsNotApplicable', status: 'skipped' });
        }

        const url = validEndpoint(endpoint, target.kind);
        checks.unshift({
            step: 'target',
            finding: url ? 'endpointReady' : 'invalidEndpoint',
            status: url ? 'passed' : 'failed',
        });
        if (target.probe === 'network') {
            checks.push({ step: 'access', finding: 'apiProbeUnavailable', status: 'skipped' });
        }
        if (!url) return;

        if (target.probe === 'nosql') {
            begin('access');
            const emulator = target.kind === 'emulator';
            const localAuthDisabled = checks.find((check) => check.step === 'accountSettings')?.network
                ?.localAuthDisabled;
            const useKey =
                emulator || mode === AuthenticationMethod.accountKey || (mode === AuthenticationMethod.auto && !!key);
            const auth = useKey ? 'key' : mode === AuthenticationMethod.managedIdentity ? 'identity' : 'entra';
            const credential: CosmosDBCredential | undefined =
                auth === 'key'
                    ? key
                        ? { type: AuthenticationMethod.accountKey, key }
                        : undefined
                    : auth === 'identity'
                      ? {
                            type: AuthenticationMethod.managedIdentity,
                            clientId: vscode.workspace
                                .getConfiguration()
                                .get<string>(ext.settingsKeys.authManagedIdentityClientId),
                        }
                      : { type: AuthenticationMethod.entraId, tenantId };

            let access: CheckResult;
            if (!credential) {
                access = {
                    step: 'access',
                    finding: localAuthDisabled ? 'localAuthDisabled' : 'missingCredentials',
                    status: 'failed',
                    auth,
                };
            } else {
                const agent =
                    emulator && url.protocol === 'https:' ? new Agent({ rejectUnauthorized: false }) : undefined;
                try {
                    const client = getCosmosClient(url.href, [credential], emulator, {
                        agent,
                        silentAuthentication: true,
                        connectionPolicy: { retryOptions: { maxRetryAttemptCount: 0 } },
                    });
                    try {
                        await bounded(parent, 12_000, (abortSignal) =>
                            client.databases.readAll({ maxItemCount: 1, abortSignal }).fetchNext(),
                        );
                        access = { step: 'access', finding: 'connected', status: 'passed', auth };
                    } finally {
                        client.dispose();
                    }
                } catch (error) {
                    parent.throwIfAborted();
                    const classification =
                        error instanceof StepTimeoutError
                            ? { finding: 'timedOut' as const }
                            : classifyAccessError(error);
                    access = { step: 'access', ...classification, status: 'failed', auth };
                } finally {
                    agent?.destroy();
                }
            }
            checks.push(access);
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
            checks.push({ step: 'dns', finding, status: 'info' });
        } catch {
            parent.throwIfAborted();
            checks.push({ step: 'dns', finding: 'unresolvedDns', status: 'info' });
        }
    } catch {
        if (!parent.aborted) checks.push({ step: active, finding: 'unexpected', status: 'failed' });
    } finally {
        update(parent.aborted ? 'cancelled' : 'completed');
    }
}
