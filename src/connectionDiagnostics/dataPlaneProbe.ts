/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient } from '@azure/cosmos';
import { Agent } from 'node:https';
import { AuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { type CosmosDBCredential, getCosmosDBCredentials } from '../cosmosdb/CosmosDBCredential';
import { getCosmosClient, type GetCosmosClientOptions } from '../cosmosdb/getCosmosClient';
import { classifyAccessError, getHttpFailure, matchesDeniedPrincipal } from './classify';
import { type CheckResult, type FailureStage } from './model';
import { type DiagnosticsRunTrace, sdkStage } from './runTrace';
import { StepTimeoutError, withStepTimeout } from './stepTimeout';
import {
    type DiagnosticsArmAccount,
    type DiagnosticsAzureAccount,
    type DiagnosticsTarget,
    validEndpoint,
} from './target';

const containerProbe = 'SELECT TOP 1 VALUE 1 FROM c';
const probeTimeoutMs = 12_000;

const authLabels = {
    [AuthenticationMethod.accountKey]: 'key',
    [AuthenticationMethod.entraId]: 'entra',
    [AuthenticationMethod.managedIdentity]: 'identity',
} as const satisfies Record<CosmosDBCredential['type'], NonNullable<CheckResult['auth']>>;

type DataPlaneProbeOptions = {
    target: DiagnosticsTarget;
    url: URL;
    emulator: boolean;
    key?: string;
    tenantId?: string;
    arm?: DiagnosticsArmAccount;
    azureAccount?: DiagnosticsAzureAccount;
    signal: AbortSignal;
    trace: DiagnosticsRunTrace;
    record: (result: CheckResult) => void;
    beginQuery: () => void;
    onRbacPrincipal?: (principalId: string, account: DiagnosticsAzureAccount) => void;
};

export class DataPlaneProbe {
    private auth: CheckResult['auth'];
    private principalId?: string;
    private stage: FailureStage = 'credentials';
    private lastRequest?: FailureStage;
    private lastHttp: CheckResult['http'];

    private readonly probeOptions = {
        onHttpRequest: (request) => {
            this.lastRequest = sdkStage(request);
            this.lastHttp = undefined;
        },
        onHttpResponse: (response) => {
            this.options.trace.recordResponse(response, this.options.url);
            this.lastRequest = sdkStage(response.request);
            this.lastHttp = getHttpFailure({
                statusCode: response.status,
                substatus: response.headers.get('x-ms-substatus'),
            });
        },
        connectionPolicy: {
            enableBackgroundEndpointRefreshing: false,
            retryOptions: { maxRetryAttemptCount: 0 },
        },
    } satisfies GetCosmosClientOptions;

    constructor(private readonly options: DataPlaneProbeOptions) {}

    async run(): Promise<void> {
        const { target, emulator, key, record } = this.options;
        try {
            // Do not send cloud credentials to an emulator when its saved key is missing.
            const credentials =
                target.kind === 'queryEditor'
                    ? target.connection.credentials
                    : emulator && !key
                      ? []
                      : await this.resolveAccountCredentials(target.account.name);
            if (!credentials.length) {
                record({ step: 'access', finding: 'missingCredentials', status: 'failed', failureStage: this.stage });
                return;
            }
            await this.probeWithClient(credentials);
        } catch (error) {
            this.recordFailure(error);
        }
    }

    private resolveAccountCredentials(accountName: string): Promise<CosmosDBCredential[]> {
        const { emulator, key, url, arm, tenantId, signal } = this.options;
        return withStepTimeout(signal, probeTimeoutMs, (abortSignal) =>
            getCosmosDBCredentials(
                {
                    accountName,
                    documentEndpoint: url.href,
                    isEmulator: emulator,
                    arm,
                    masterKey: key,
                    tenantId,
                },
                { silent: true, abortSignal, keyProbeOptions: this.probeOptions },
            ),
        );
    }

    private async probeWithClient(credentials: CosmosDBCredential[]): Promise<void> {
        const { target, url, emulator } = this.options;
        // The shared client accepts self-signed emulator certificates by default. Diagnostics must check trust.
        const agent = emulator && url.protocol === 'https:' ? new Agent({ rejectUnauthorized: true }) : undefined;
        const clientOptions = {
            ...this.probeOptions,
            agent,
            silentAuthentication: true,
            onAuthenticationMethod: (method, oid) => {
                this.auth = authLabels[method];
                this.principalId = oid;
            },
        } satisfies GetCosmosClientOptions;
        try {
            const client =
                target.kind === 'queryEditor'
                    ? getCosmosClient(target.connection, clientOptions)
                    : getCosmosClient(url.href, credentials, emulator, clientOptions);
            try {
                const listingFailure = await this.checkDatabases(client);
                // A role scoped to one container may allow queries without permitting account-wide listing.
                if (
                    target.kind === 'queryEditor' &&
                    (!listingFailure || (listingFailure.finding === 'dataRbac' && this.lastRequest === 'listDatabases'))
                ) {
                    await this.checkContainer(client, target.connection);
                }
            } finally {
                client.dispose();
            }
        } finally {
            agent?.destroy();
        }
    }

    private async checkDatabases(client: CosmosClient): Promise<CheckResult | undefined> {
        const { signal, record } = this.options;
        this.beginOperation('listDatabases');
        try {
            await withStepTimeout(signal, probeTimeoutMs, (abortSignal) =>
                client.databases.readAll({ maxItemCount: 1, abortSignal }).fetchNext(),
            );
        } catch (error) {
            return this.recordFailure(error);
        }
        record({ step: 'access', finding: 'connected', status: 'passed', auth: this.auth });
        return undefined;
    }

    private async checkContainer(
        client: CosmosClient,
        { databaseId, containerId }: { databaseId: string; containerId: string },
    ): Promise<void> {
        const { signal, record, beginQuery } = this.options;
        beginQuery();
        this.beginOperation('query');
        await withStepTimeout(signal, probeTimeoutMs, (abortSignal) =>
            client
                .database(databaseId)
                .container(containerId)
                .items.query(containerProbe, { maxItemCount: 1, abortSignal })
                .fetchNext(),
        );
        record({ step: 'query', finding: 'querySucceeded', status: 'passed' });
    }

    private beginOperation(stage: 'listDatabases' | 'query'): void {
        this.stage = stage;
        this.lastRequest = undefined;
        this.lastHttp = undefined;
    }

    private recordFailure(error: unknown): CheckResult {
        this.options.signal.throwIfAborted();
        const sdkHttp = getHttpFailure(error);
        const http =
            sdkHttp && sdkHttp.status === this.lastHttp?.status && sdkHttp.substatus === undefined
                ? this.lastHttp
                : sdkHttp;
        const classification = this.classifyFailure(error, http);
        const needsRole = classification.finding === 'dataRbac';
        const failureStage =
            classification.finding === 'tokenUnavailable' || this.stage === 'credentials'
                ? 'credentials'
                : (this.lastRequest ?? this.stage);
        if (needsRole) this.notifyRbacPrincipal(error);
        const result: CheckResult = {
            step: this.stage === 'query' ? 'query' : 'access',
            ...classification,
            status: needsRole ? 'info' : 'failed',
            ...(this.stage === 'query' ? {} : { auth: this.auth }),
            failureStage,
            ...(http ? { http } : {}),
        };
        this.options.record(result);
        return result;
    }

    private classifyFailure(
        error: unknown,
        http: CheckResult['http'],
    ): Pick<CheckResult, 'finding' | 'observedClientIp'> {
        if (error instanceof StepTimeoutError) return { finding: 'timedOut' };
        if (this.stage === 'query' && http?.status === 404 && this.lastRequest !== 'accountMetadata') {
            return { finding: 'containerUnavailable' };
        }
        return classifyAccessError(error, http);
    }

    private notifyRbacPrincipal(error: unknown): void {
        const { target, azureAccount, arm, url, onRbacPrincipal } = this.options;
        if (
            azureAccount &&
            (target.kind !== 'queryEditor' || (this.stage !== 'query' && this.lastRequest === 'accountMetadata')) &&
            validEndpoint(arm?.databaseAccount.documentEndpoint, false)?.origin === url.origin &&
            this.principalId &&
            this.auth !== 'key' &&
            matchesDeniedPrincipal(error, this.principalId)
        ) {
            onRbacPrincipal?.(this.principalId, azureAccount);
        }
    }
}
