/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHttpHeaders, createPipelineRequest } from '@azure/core-rest-pipeline';
import { RestError } from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod, getPreferredAuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { type CosmosDBCredential } from '../cosmosdb/CosmosDBCredential';
import { type GetCosmosClientOptions } from '../cosmosdb/getCosmosClient';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type DiagnosticsState, isOverviewStep, overviewSteps } from './model';
import { phaseLabel, renderJsonReport, renderReport } from './presentation';
import { runDiagnostics } from './run';
import { type AccountDiagnosticsTarget, type DiagnosticsTarget } from './target';

const io = vi.hoisted(() => ({
    fetchNext: vi.fn(),
    database: vi.fn(),
    readAll: vi.fn(),
    dispose: vi.fn(),
    getDatabaseAccount: vi.fn(),
    get: vi.fn(),
    listReadOnlyKeys: vi.fn(),
    listKeys: vi.fn(),
    lookup: vi.fn(),
    getCosmosClient: vi.fn(),
    getManagedIdentityAuth: vi.fn(),
    log: vi.fn(),
    telemetry: vi.fn(),
    metricsList: vi.fn(),
    alertsList: vi.fn(),
    advisorList: vi.fn(),
    queryResource: vi.fn(),
    createLogsQueryClient: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));
vi.mock('../cosmosdb/getCosmosClient', () => ({
    getCosmosClient: io.getCosmosClient,
}));
vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { info: io.log }, settingsKeys: { connectionTimeout: 'connectionTimeout' } },
}));
vi.mock('../cosmosdb/AuthenticationMethod', { spy: true });
vi.mock('../cosmosdb/utils/managedIdentityUtils', () => ({ getManagedIdentityAuth: io.getManagedIdentityAuth }));
vi.mock('../utils/azureClients', () => ({
    createCosmosDBManagementClient: () => Promise.resolve({ databaseAccounts: io }),
    createMonitorClient: () => Promise.resolve({ metrics: { list: io.metricsList } }),
    createAlertsManagementClient: () => Promise.resolve({ alerts: { getAll: io.alertsList } }),
    createAdvisorClient: () => Promise.resolve({ recommendations: { list: io.advisorList } }),
    createLogsQueryClient: io.createLogsQueryClient,
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    parseError: (error: Error) => ({ message: error.message }),
    callWithTelemetryAndErrorHandling: async (name: string, run: (context: Partial<IActionContext>) => unknown) => {
        const context: Partial<IActionContext> = {
            errorHandling: { issueProperties: {} },
            telemetry: { properties: {}, measurements: {} },
            valuesToMask: [],
        };
        const result = await run(context);
        io.telemetry(name, context.telemetry);
        return result;
    },
}));

const attached: AccountDiagnosticsTarget = {
    kind: 'attached',
    probe: 'nosql',
    account: {
        id: 'attachment',
        storageId: 'storage',
        name: 'Saved account',
        connectionString: 'AccountEndpoint=https://example.test/;AccountKey=secret;',
        isEmulator: false,
    },
};

const cloud: Extract<DiagnosticsTarget, { kind: 'azure' }> = {
    kind: 'azure',
    probe: 'nosql',
    account: {
        id: '/subscriptions/subscription/resourceGroups/group/providers/Microsoft.DocumentDB/databaseAccounts/account',
        name: 'account',
        resourceGroup: 'group',
        subscription: { subscriptionId: 'subscription', tenantId: 'tenant' },
        raw: {},
    } as Extract<DiagnosticsTarget, { kind: 'azure' }>['account'],
};
const queryTarget: Extract<DiagnosticsTarget, { kind: 'queryEditor' }> = {
    kind: 'queryEditor',
    probe: 'query',
    connection: {
        endpoint: 'https://selected.example.test/',
        databaseId: 'selected-database',
        containerId: 'selected-container',
        credentials: [{ type: AuthenticationMethod.accountKey, key: 'synthetic-query-key' }],
        isEmulator: false,
    },
};

async function diagnose(
    target: DiagnosticsTarget,
    controller = new AbortController(),
    onPrincipal?: (id: string) => void,
) {
    const states: DiagnosticsState[] = [];
    await runDiagnostics(target, controller.signal, (state) => states.push(state), onPrincipal);
    return states;
}

describe('diagnosing a NoSQL connection', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(getPreferredAuthenticationMethod).mockReturnValue(AuthenticationMethod.auto);
        io.getDatabaseAccount.mockResolvedValue({});
        io.getCosmosClient.mockImplementation(
            (
                _endpoint: string,
                credentials: CosmosDBCredential[],
                _emulator: boolean,
                options: GetCosmosClientOptions,
            ) => {
                options.onAuthenticationMethod?.(credentials[0].type);
                return {
                    databases: { readAll: io.readAll },
                    database: io.database,
                    dispose: io.dispose,
                    getDatabaseAccount: io.getDatabaseAccount,
                };
            },
        );
        io.fetchNext.mockResolvedValue({});
        io.readAll.mockReturnValue({ fetchNext: io.fetchNext });
        io.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
        io.metricsList.mockResolvedValue({ value: [] });
        const emptyPage = { byPage: () => ({ next: async () => ({ value: [], done: false }) }) };
        io.alertsList.mockReturnValue(emptyPage);
        io.advisorList.mockReturnValue(emptyPage);
        io.createLogsQueryClient.mockResolvedValue({ queryResource: io.queryResource });
        io.queryResource.mockResolvedValue({ status: 'Success', tables: [{ columnDescriptors: [], rows: [] }] });
    });

    it.each([true, false])(
        'reports the same SDK RBAC denial from both entry points (ARM endpoint matches: %s)',
        async (matches) => {
            const principal = 'a8325ba3-c1a1-4db8-b914-ddf5cbf1326d';
            const denied = Object.assign(
                new Error(`Principal [${principal}] does not have required RBAC permissions for readMetadata.`),
                { code: 403, substatus: 5301 },
            );
            const documentEndpoint = matches ? queryTarget.connection.endpoint : 'https://another.example.test/';
            io.get.mockResolvedValue({ documentEndpoint, disableLocalAuth: true });
            const connection: NoSqlQueryConnection = {
                ...queryTarget.connection,
                credentials: [{ type: AuthenticationMethod.entraId, tenantId: 'tenant' }],
                azureMetadata: {
                    accountId: cloud.account.id,
                    accountName: cloud.account.name,
                    resourceGroup: cloud.account.resourceGroup,
                    subscription: cloud.account.subscription,
                } as NoSqlQueryConnection['azureMetadata'],
            };
            io.getCosmosClient.mockImplementation((source, credentialsOrOptions, _emulator, options) => {
                const clientOptions: GetCosmosClientOptions =
                    typeof source === 'string' ? options : credentialsOrOptions;
                const endpoint: string = typeof source === 'string' ? source : source.endpoint;
                clientOptions.onAuthenticationMethod?.(AuthenticationMethod.entraId, principal);
                return {
                    getDatabaseAccount: () =>
                        Promise.reject(Object.assign(new Error('Transport timeout'), { code: 'ETIMEDOUT' })),
                    databases: {
                        readAll: () => ({
                            fetchNext: () => {
                                clientOptions.onHttpRequest?.(createPipelineRequest({ url: endpoint }));
                                return Promise.reject(denied);
                            },
                        }),
                    },
                    database: io.database,
                    dispose: io.dispose,
                };
            });
            const onPrincipal = vi.fn();
            const account = (await diagnose(cloud)).at(-1)!;
            const editor = (await diagnose({ ...queryTarget, connection }, undefined, onPrincipal)).at(-1)!;
            expect(phaseLabel(account)).toBe('Cosmos DB data role required.');
            expect(phaseLabel(editor)).toBe(phaseLabel(account));
            expect(editor.checks.find(({ step }) => step === 'access')).toEqual(
                account.checks.find(({ step }) => step === 'access'),
            );
            expect(editor.checks).toContainEqual({ step: 'query', finding: 'queryNotRun', status: 'skipped' });
            expect(editor.checks.find(({ step }) => step === 'accountSettings')).toEqual(
                account.checks.find(({ step }) => step === 'accountSettings'),
            );
            expect(editor.kind).toBe('azure');
            const verifiedAccount = expect.objectContaining({ id: cloud.account.id });
            expect(onPrincipal.mock.calls).toEqual(matches ? [[principal, verifiedAccount]] : []);
            expect(io.database).not.toHaveBeenCalled();
        },
    );

    it('uses the standard credential candidates when account-key auth is disabled', async () => {
        io.get.mockResolvedValue({ documentEndpoint: 'https://example.test/', disableLocalAuth: true });
        const identity = { type: AuthenticationMethod.managedIdentity, clientId: 'test-managed-identity' } as const;
        io.getManagedIdentityAuth.mockResolvedValue(identity);
        io.fetchNext.mockImplementation(() => {
            const options: GetCosmosClientOptions = io.getCosmosClient.mock.lastCall?.[3];
            options.onAuthenticationMethod?.(identity.type);
            return Promise.resolve({});
        });

        const state = (await diagnose(cloud)).at(-1)!;

        expect(io.get).toHaveBeenCalledOnce();
        expect(io.listKeys).not.toHaveBeenCalled();
        expect(io.listReadOnlyKeys).not.toHaveBeenCalled();
        expect(io.getCosmosClient).toHaveBeenCalledExactlyOnceWith(
            'https://example.test/',
            [{ type: AuthenticationMethod.entraId, tenantId: 'tenant' }, identity],
            false,
            expect.objectContaining({ silentAuthentication: true }),
        );
        expect(state.checks).toContainEqual({
            step: 'access',
            status: 'passed',
            finding: 'connected',
            auth: 'identity',
        });
        expect(renderReport(state)).not.toContain('test-managed-identity');
    });

    it('uses the shared ARM key fallback without requesting account settings twice', async () => {
        io.get.mockResolvedValue({ documentEndpoint: 'https://example.test/' });
        io.listKeys.mockRejectedValue(new RestError('Key listing forbidden', { statusCode: 403 }));
        io.listReadOnlyKeys.mockResolvedValue({ primaryReadonlyMasterKey: 'synthetic-key' });

        const state = (await diagnose(cloud)).at(-1)!;

        expect(io.get).toHaveBeenCalledOnce();
        expect(io.listKeys).toHaveBeenCalledExactlyOnceWith('group', 'account', {
            abortSignal: expect.any(AbortSignal),
        });
        expect(io.listReadOnlyKeys).toHaveBeenCalledExactlyOnceWith('group', 'account', {
            abortSignal: expect.any(AbortSignal),
        });
        expect(state.checks).toContainEqual({ step: 'access', status: 'passed', finding: 'connected', auth: 'key' });
        expect(JSON.stringify(state)).not.toContain('synthetic-key');
    });

    it('uses the shared Entra fallback for an attached account that rejects key authentication', async () => {
        io.getDatabaseAccount.mockRejectedValue(new Error('Local Authorization is disabled.'));

        const state = (await diagnose(attached)).at(-1)!;

        expect(io.getDatabaseAccount).toHaveBeenCalledExactlyOnceWith({ abortSignal: expect.any(AbortSignal) });
        expect(io.getCosmosClient).toHaveBeenLastCalledWith(
            'https://example.test/',
            [{ type: AuthenticationMethod.entraId, tenantId: undefined }],
            false,
            expect.objectContaining({ silentAuthentication: true }),
        );
        expect(state.checks).toContainEqual({ step: 'access', status: 'passed', finding: 'connected', auth: 'entra' });
        expect(io.dispose).toHaveBeenCalledTimes(2);
    });

    it.each([
        { matches: true, firewall: false, eligible: true },
        { matches: false, firewall: false, eligible: false },
        { matches: true, firewall: true, eligible: false },
    ])('offers RBAC remediation only for the denied identity: %j', async ({ matches, firewall, eligible }) => {
        const principal = 'f89e099d-3d03-46b0-b36d-d0ab4eaa81af';
        const deniedPrincipal = matches ? principal : '8ff951bf-6c50-4130-b529-8af6db41373a';
        const onPrincipal = vi.fn();
        io.get.mockResolvedValue({ documentEndpoint: 'https://example.test/', disableLocalAuth: true });
        io.fetchNext.mockImplementation(() => {
            const options: GetCosmosClientOptions = io.getCosmosClient.mock.lastCall?.[3];
            options.onAuthenticationMethod?.(AuthenticationMethod.entraId, principal);
            const denial = `Principal [${deniedPrincipal}] does not have required RBAC permissions to perform action readMetadata.`;
            const message = firewall ? `Blocked by your Cosmos DB account firewall settings. ${denial}` : denial;
            throw Object.assign(new Error('Server denied the request'), { code: 403, body: { message } });
        });
        const state = (await diagnose(cloud, new AbortController(), onPrincipal)).at(-1)!;
        expect(state.checks).toContainEqual(
            expect.objectContaining({
                step: 'access',
                status: firewall ? 'failed' : 'info',
                finding: firewall ? 'firewallUnknown' : 'dataRbac',
                auth: 'entra',
            }),
        );
        expect(onPrincipal.mock.calls).toEqual(eligible ? [[principal, cloud.account]] : []);
        expect(io.lookup).not.toHaveBeenCalled();
        expect(renderReport(state) + JSON.stringify([state, io.log.mock.calls, io.telemetry.mock.calls])).not.toContain(
            principal,
        );
    });
    it('logs the actual alternate endpoint locally and emits only redacted evidence for sharing and telemetry', async () => {
        io.get.mockResolvedValue({ documentEndpoint: 'https://configured.example.test/', disableLocalAuth: true });
        io.fetchNext.mockImplementation(() => {
            const options: GetCosmosClientOptions = io.getCosmosClient.mock.calls[0][3];
            options.onHttpResponse?.({
                request: createPipelineRequest({
                    url: 'https://regional.example.test/dbs?secret=query',
                    headers: createHttpHeaders({ Authorization: 'sensitive-auth-header' }),
                }),
                status: 403,
                headers: createHttpHeaders({ 'x-ms-substatus': '1000' }),
            });
            throw Object.assign(new Error('Blocked by your Cosmos DB account firewall settings. raw-response'), {
                code: 403,
            });
        });

        const state = (await diagnose(cloud)).at(-1)!;
        const report = renderReport(state);
        const local = io.log.mock.calls.flat().join('\n');
        const runEvents = io.telemetry.mock.calls.filter(([name]) => name === 'cosmosDB.diagnostics.run');
        expect(runEvents).toEqual([
            [
                'cosmosDB.diagnostics.run',
                expect.objectContaining({
                    properties: expect.objectContaining({
                        diagnosticsRunId: state.trace?.runId,
                        connectionOutcome: 'failed',
                        authMethod: 'entra',
                        findingCodes: expect.stringContaining('firewallUnknown'),
                    }),
                    measurements: { durationMs: expect.any(Number), checkCount: 3 + overviewSteps.length },
                }),
            ],
        ]);
        expect(local).toContain(
            'sdk target=alternate operation=listDatabases status=403 substatus=1000 endpoint=https://regional.example.test',
        );
        expect(report).toContain('Check log');
        expect(report).toContain(`Run ID: ${state.trace?.runId}`);
        expect(report).toContain('sdk target=alternate operation=listDatabases status=403 substatus=1000');
        expect(report).not.toContain('check=dns');
        expect(report).toContain('finished phase=completed');
        expect(local).not.toMatch(/secret=query|sensitive-auth-header|raw-response/);
        expect(report + JSON.stringify(runEvents)).not.toMatch(
            /(?:configured|regional)\.example\.test|secret=query|sensitive-auth-header|raw-response/,
        );
    });

    it('uses a bounded, read-only SDK operation without a redundant DNS lookup on success', async () => {
        const states = await diagnose(attached);
        expect(io.get).not.toHaveBeenCalled();
        expect(io.readAll).toHaveBeenCalledExactlyOnceWith({ maxItemCount: 1, abortSignal: expect.any(AbortSignal) });
        expect(io.fetchNext).toHaveBeenCalledOnce();
        expect(io.database).not.toHaveBeenCalled();
        expect(io.dispose).toHaveBeenCalledTimes(2);
        expect(io.lookup).not.toHaveBeenCalled();
        expect(io.metricsList).not.toHaveBeenCalled();
        expect(io.createLogsQueryClient).not.toHaveBeenCalled();
        expect(states.at(-1)).toMatchObject({
            phase: 'completed',
            checks: [
                { finding: 'endpointReady' },
                { finding: 'settingsNotApplicable' },
                { finding: 'connected', auth: 'key' },
            ],
        });
        expect(JSON.stringify(states)).not.toContain('secret');
    });

    it('keeps the DNS lookup after an SDK name-resolution failure', async () => {
        io.fetchNext.mockRejectedValue({ code: 'ENOTFOUND' });
        io.lookup.mockRejectedValue(new Error('name could not be resolved locally'));

        const state = (await diagnose(attached)).at(-1)!;
        expect(io.lookup).toHaveBeenCalledExactlyOnceWith('example.test', { all: true });
        expect(state.checks).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ step: 'access', status: 'failed', finding: 'dnsFailure' }),
                { step: 'dns', status: 'info', finding: 'unresolvedDns' },
            ]),
        );
    });

    it.each([
        ['http://localhost:8081/', 'http://localhost:8081/'],
        ['http://localhost:80/', 'http://localhost/'],
        ['http://localhost/', 'http://localhost/'],
    ])('uses the saved emulator endpoint %s and attributes refusals to the SDK stage', async (saved, endpoint) => {
        io.fetchNext.mockImplementation(() => {
            const options: GetCosmosClientOptions = io.getCosmosClient.mock.lastCall?.[3];
            options.onHttpRequest?.(createPipelineRequest({ url: endpoint }));
            throw new Error('Transport error', { cause: Object.assign(new Error(), { code: 'ECONNREFUSED' }) });
        });
        const state = (
            await diagnose({
                ...attached,
                kind: 'emulator',
                account: {
                    ...attached.account,
                    isEmulator: true,
                    connectionString: `AccountEndpoint=${saved};AccountKey=secret;`,
                },
            })
        ).at(-1)!;
        expect(state.checks).toContainEqual(
            expect.objectContaining({
                step: 'access',
                finding: 'connectionRefused',
                failureStage: 'accountMetadata',
            }),
        );
        expect(renderReport(state)).toContain('The emulator connection was refused.');
        expect(renderReport(state)).not.toContain('localhost');
        expect(io.getCosmosClient.mock.lastCall?.[0]).toBe(endpoint);
        expect(io.getCosmosClient.mock.lastCall?.[3].agent).toBeUndefined();
    });

    it('reports disabled key authentication when reusing an existing Query Editor key', async () => {
        io.fetchNext.mockRejectedValue({ code: 403, message: 'Local Authorization is disabled.' });
        io.getCosmosClient.mockImplementation((_connection, options: GetCosmosClientOptions) => {
            options.onAuthenticationMethod?.(AuthenticationMethod.accountKey);
            return { databases: { readAll: io.readAll }, dispose: io.dispose, database: io.database };
        });
        const state = (await diagnose(queryTarget)).at(-1)!;

        expect(io.getCosmosClient).toHaveBeenCalledExactlyOnceWith(
            queryTarget.connection,
            expect.objectContaining({ silentAuthentication: true }),
        );
        expect(state.checks).toContainEqual(
            expect.objectContaining({
                step: 'access',
                finding: 'localAuthDisabled',
                status: 'failed',
                http: { status: 403 },
            }),
        );
        expect(renderReport(state)).toContain('Account-key authentication is disabled.');
        expect(io.database).not.toHaveBeenCalled();
    });

    it.each(['saved emulator', 'Query Editor'] as const)(
        'validates the HTTPS emulator certificate when started from %s',
        async (source) => {
            const endpoint = 'https://localhost:8081/';
            const target: DiagnosticsTarget =
                source === 'Query Editor'
                    ? { ...queryTarget, connection: { ...queryTarget.connection, endpoint, isEmulator: true } }
                    : {
                          ...attached,
                          kind: 'emulator',
                          account: {
                              ...attached.account,
                              isEmulator: true,
                              connectionString: `AccountEndpoint=${endpoint};AccountKey=secret;`,
                          },
                      };
            io.getCosmosClient.mockReturnValueOnce({ databases: { readAll: io.readAll }, dispose: io.dispose });
            io.fetchNext.mockRejectedValueOnce({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });

            const state = (await diagnose(target)).at(-1)!;

            const optionsIndex = source === 'Query Editor' ? 1 : 3;
            expect(io.getCosmosClient.mock.lastCall?.[optionsIndex]).toMatchObject({
                agent: { options: { rejectUnauthorized: true } },
            });
            expect(state.checks).toContainEqual(
                expect.objectContaining({ step: 'access', status: 'failed', finding: 'tlsFailure' }),
            );
            expect(renderReport(state)).toContain('VS Code extension host trusts the emulator certificate');
            expect(io.getCosmosClient).toHaveBeenCalledTimes(1);
        },
    );

    it.each([true, false])('checks metadata and query access independently (query succeeds: %s)', async (success) => {
        const fetchPage = vi.fn().mockImplementation(() => {
            if (success) return Promise.resolve({ resources: ['must-not-be-reported'] });
            return Promise.reject(
                Object.assign(new Error('Principal does not have required RBAC permissions to executeQuery.'), {
                    code: 403,
                    substatus: 0,
                }),
            );
        });
        const query = vi.fn().mockReturnValue({ fetchNext: fetchPage });
        const container = vi.fn().mockReturnValue({ items: { query } });
        const database = vi.fn().mockReturnValue({ container });
        io.getCosmosClient.mockImplementation((_connection, options: GetCosmosClientOptions) => {
            options.onAuthenticationMethod?.(AuthenticationMethod.accountKey);
            return { databases: { readAll: io.readAll }, dispose: io.dispose, database };
        });

        const onPrincipal = vi.fn();
        const state = (await diagnose(queryTarget, undefined, onPrincipal)).at(-1)!;
        expect(io.getCosmosClient).toHaveBeenCalledExactlyOnceWith(
            queryTarget.connection,
            expect.objectContaining({ silentAuthentication: true }),
        );
        expect(io.getDatabaseAccount).not.toHaveBeenCalled();
        expect(io.get).not.toHaveBeenCalled();
        expect(io.readAll).toHaveBeenCalledExactlyOnceWith({ maxItemCount: 1, abortSignal: expect.any(AbortSignal) });
        expect(database).toHaveBeenCalledExactlyOnceWith(queryTarget.connection.databaseId);
        expect(container).toHaveBeenCalledExactlyOnceWith(queryTarget.connection.containerId);
        expect(query).toHaveBeenCalledExactlyOnceWith('SELECT TOP 1 VALUE 1 FROM c', {
            maxItemCount: 1,
            abortSignal: expect.any(AbortSignal),
        });
        expect(fetchPage).toHaveBeenCalledOnce();
        expect(io.dispose).toHaveBeenCalledOnce();
        expect(state.checks).toContainEqual({
            step: 'access',
            status: 'passed',
            finding: 'connected',
            auth: 'key',
        });
        expect(state.checks).toContainEqual(
            success
                ? { step: 'query', status: 'passed', finding: 'querySucceeded' }
                : {
                      step: 'query',
                      status: 'info',
                      finding: 'dataRbac',
                      failureStage: 'query',
                      http: { status: 403, substatus: 0 },
                  },
        );
        expect(onPrincipal).not.toHaveBeenCalled();
        expect(phaseLabel(state)).toBe(
            success ? 'Query access to the selected container verified.' : 'Cosmos DB data role required.',
        );
        expect(renderReport(state) + renderJsonReport(state) + JSON.stringify(io.telemetry.mock.calls)).not.toMatch(
            /must-not-be-reported|selected\.example|selected-container|selected-database|synthetic-query-key|SELECT TOP/,
        );
    });

    it('does not attempt the scoped query when the base SDK probe cannot reach a healthy service', async () => {
        const database = vi.fn();
        io.getCosmosClient.mockReturnValue({
            databases: { readAll: io.readAll },
            dispose: io.dispose,
            database,
        });
        io.fetchNext.mockRejectedValue({ code: 503, substatus: 20001 });
        const state = (await diagnose(queryTarget)).at(-1)!;
        expect(database).not.toHaveBeenCalled();
        expect(state.checks).toContainEqual(
            expect.objectContaining({
                step: 'access',
                finding: 'serviceUnavailable',
                failureStage: 'listDatabases',
                http: { status: 503, substatus: 20001 },
            }),
        );
        expect(state.checks).toContainEqual({ step: 'query', finding: 'queryNotRun', status: 'skipped' });
    });

    it('still verifies container-scoped query access if only account-wide listing is denied', async () => {
        const fetchQuery = vi.fn().mockResolvedValue({});
        const onPrincipal = vi.fn();
        io.getCosmosClient.mockImplementation((_connection, options: GetCosmosClientOptions) => ({
            databases: {
                readAll: () => ({
                    fetchNext: () => {
                        options.onHttpRequest?.(
                            createPipelineRequest({ url: `${queryTarget.connection.endpoint}dbs` }),
                        );
                        return Promise.reject(
                            Object.assign(new Error('Principal does not have required RBAC permissions.'), {
                                code: 403,
                                substatus: 5301,
                            }),
                        );
                    },
                }),
            },
            dispose: io.dispose,
            database: () => ({ container: () => ({ items: { query: () => ({ fetchNext: fetchQuery }) } }) }),
        }));

        const state = (await diagnose(queryTarget, undefined, onPrincipal)).at(-1)!;
        expect(state.checks).toContainEqual(
            expect.objectContaining({
                step: 'access',
                finding: 'dataRbac',
                failureStage: 'listDatabases',
            }),
        );
        expect(fetchQuery).toHaveBeenCalledOnce();
        expect(phaseLabel(state)).toBe('Query access to the selected container verified.');
        expect(onPrincipal).not.toHaveBeenCalled();
    });

    it('does not mistake successful metadata for a query response when the query has no HTTP response', async () => {
        const query = vi.fn().mockReturnValue({
            fetchNext: () => Promise.reject(Object.assign(new Error('Transport error'), { code: 'ECONNRESET' })),
        });
        io.getCosmosClient.mockImplementation((_connection, options: GetCosmosClientOptions) => ({
            databases: {
                readAll: () => ({
                    fetchNext: () => {
                        options.onHttpResponse?.({
                            request: createPipelineRequest({ url: queryTarget.connection.endpoint }),
                            status: 200,
                            headers: createHttpHeaders({ 'x-ms-substatus': '0' }),
                        });
                        return Promise.resolve({});
                    },
                }),
            },
            dispose: io.dispose,
            database: () => ({ container: () => ({ items: { query } }) }),
        }));

        const state = (await diagnose(queryTarget)).at(-1)!;
        expect(state.checks.find(({ step }) => step === 'query')).toEqual({
            step: 'query',
            status: 'failed',
            failureStage: 'query',
            finding: 'connectionReset',
        });
    });

    it('aborts a scoped query and disposes the client', async () => {
        const controller = new AbortController();
        const query = vi.fn().mockReturnValue({
            fetchNext: () => {
                controller.abort();
                return new Promise(() => {});
            },
        });
        io.getCosmosClient.mockReturnValue({
            databases: { readAll: io.readAll },
            dispose: io.dispose,
            database: () => ({ container: () => ({ items: { query } }) }),
        });

        const state = (await diagnose(queryTarget, controller)).at(-1)!;
        expect(state.phase).toBe('cancelled');
        expect(query.mock.calls[0][1].abortSignal.aborted).toBe(true);
        expect(io.dispose).toHaveBeenCalledOnce();
    });

    it('uses the ARM settings as context, not as proof of access', async () => {
        io.get.mockResolvedValue({
            documentEndpoint: 'https://example.test/',
            disableLocalAuth: true,
            publicNetworkAccess: 'Disabled',
            ipRules: [{ ipAddressOrRange: '203.0.113.45' }],
            privateEndpointConnections: [{}],
        });

        io.fetchNext.mockRejectedValue({
            code: 403,
            message: 'Request originated from client VNET through private endpoint.',
        });
        const states = await diagnose(cloud);
        expect(states.filter((state) => state.phase === 'running').map((state) => state.active)).toEqual([
            'accountSettings',
            'target',
            'access',
            'dns',
            'accountOverview',
        ]);
        expect(io.listReadOnlyKeys).not.toHaveBeenCalled();
        expect(io.listKeys).not.toHaveBeenCalled();
        expect(states.at(-1)?.checks.filter(({ step }) => !isOverviewStep(step))).toMatchObject([
            { finding: 'endpointReady' },
            { network: { publicAccess: 'disabled', ipRules: 1, privateEndpoints: 1 } },
            { finding: 'firewallPrivateEndpoint', auth: 'entra' },
            { finding: 'privateDns' },
        ]);
        expect(JSON.stringify(states)).not.toContain('203.0.113.45');
    });

    it.each([0, 1])(
        'only checks DNS after a firewall denial if private routing may matter (%i private endpoints)',
        async (privateEndpoints) => {
            io.get.mockResolvedValue({
                documentEndpoint: 'https://example.test/',
                disableLocalAuth: true,
                publicNetworkAccess: 'Enabled',
                privateEndpointConnections: Array.from({ length: privateEndpoints }, () => ({})),
            });
            io.lookup.mockResolvedValue([{ address: '203.0.113.1', family: 4 }]);
            io.fetchNext.mockRejectedValue({
                code: 403,
                message: 'Blocked by your Cosmos DB account firewall settings.',
            });
            const state = (await diagnose(cloud)).at(-1)!;
            expect(io.lookup).toHaveBeenCalledTimes(privateEndpoints > 0 ? 1 : 0);
            expect(state.checks.filter(({ step }) => !isOverviewStep(step))).toEqual([
                expect.objectContaining({ step: 'target', status: 'passed' }),
                expect.objectContaining({ step: 'accountSettings', status: 'passed' }),
                expect.objectContaining({ step: 'access', status: 'failed', finding: 'firewallUnknown' }),
                ...(privateEndpoints > 0 ? [{ step: 'dns', status: 'passed', finding: 'publicDns' }] : []),
            ]);
        },
    );

    it('runs ARM and DNS checks without retrieving credentials or sending a NoSQL request for other APIs', async () => {
        io.get.mockResolvedValue({
            documentEndpoint: 'https://example.test/',
            publicNetworkAccess: 'Disabled',
        });
        const states = await diagnose({ ...cloud, probe: 'network' });
        expect(io.get).toHaveBeenCalledOnce();
        expect(io.listReadOnlyKeys).not.toHaveBeenCalled();
        expect(io.listKeys).not.toHaveBeenCalled();
        expect(io.getManagedIdentityAuth).not.toHaveBeenCalled();
        expect(io.getCosmosClient).not.toHaveBeenCalled();
        expect(io.readAll).not.toHaveBeenCalled();
        expect(io.lookup).toHaveBeenCalledExactlyOnceWith('example.test', { all: true });
        expect(states.at(-1)?.phase).toBe('completed');
        expect(states.at(-1)?.checks.filter(({ step }) => !isOverviewStep(step))).toMatchObject([
            { finding: 'endpointReady' },
            { finding: 'settingsRead', network: { publicAccess: 'disabled' } },
            { finding: 'apiProbeUnavailable', status: 'skipped' },
            { finding: 'privateDns' },
        ]);
    });

    it('verifies Overview reads independently and distinguishes a denied read from a missing log table', async () => {
        io.get.mockResolvedValue({ documentEndpoint: 'https://example.test/', disableLocalAuth: true });
        io.metricsList.mockRejectedValue({ statusCode: 403, message: 'private metric error' });
        io.queryResource
            .mockResolvedValueOnce({ status: 'Success', tables: [{ columnDescriptors: [], rows: [] }] })
            .mockRejectedValueOnce({
                code: 'SemanticError',
                message: 'Failed to resolve table CDBQueryRuntimeStatistics',
            });
        const state = (await diagnose(cloud)).at(-1)!;
        expect(phaseLabel(state)).toBe('Cosmos DB data-plane access verified.');
        expect(state.checks.filter(({ step }) => isOverviewStep(step))).toEqual([
            { step: 'metrics', finding: 'overviewDenied', status: 'info', http: { status: 403 } },
            { step: 'alerts', finding: 'overviewRead', status: 'passed' },
            { step: 'advisor', finding: 'overviewRead', status: 'passed' },
            { step: 'requestLogs', finding: 'overviewRead', status: 'passed' },
            { step: 'queryLogs', finding: 'overviewLogsMissing', status: 'info' },
        ]);
        expect(io.metricsList).toHaveBeenCalledExactlyOnceWith(
            cloud.account.id,
            expect.objectContaining({ metricnames: 'TotalRequests' }),
        );
        expect(io.alertsList).toHaveBeenCalledExactlyOnceWith(
            '/subscriptions/subscription',
            expect.objectContaining({ targetResource: cloud.account.id, pageCount: 1 }),
        );
        expect(io.advisorList).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ top: 1 }));
        expect(io.createLogsQueryClient).toHaveBeenCalledExactlyOnceWith(
            expect.anything(),
            cloud.account.subscription,
            { createIfNone: false },
        );
        expect(io.queryResource.mock.calls.map(([resource, query]) => [resource, query])).toEqual([
            [cloud.account.id.slice(1), 'CDBDataPlaneRequests | take 0'],
            [cloud.account.id.slice(1), 'CDBQueryRuntimeStatistics | take 0'],
        ]);
        const report = renderReport(state);
        expect(report).toContain('## Account Overview access');
        expect(report).toContain('list fired alerts for this account');
        expect(report).toContain('CDBDataPlaneRequests table succeeded. The check did not request log entries.');
        expect(report).toContain('Required diagnostic category: QueryRuntimeStatistics.');
        expect(
            report +
                renderJsonReport(state) +
                JSON.stringify(io.log.mock.calls) +
                JSON.stringify(io.telemetry.mock.calls),
        ).not.toMatch(/resourceGroups\/group|private metric error|take 0/);
    });

    it('reports the duration of each Overview read, even when a different read times out', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
        try {
            io.get.mockResolvedValue({ documentEndpoint: 'https://example.test/', disableLocalAuth: true });
            io.metricsList.mockImplementation(() => new Promise(() => {}));
            io.alertsList.mockReturnValue({
                byPage: () => ({
                    next: () => new Promise((resolve) => setTimeout(() => resolve({ value: [], done: false }), 120)),
                }),
            });
            const run = diagnose(cloud);
            await vi.advanceTimersByTimeAsync(6_000);
            const state = (await run).at(-1)!;
            expect(state.checks.find(({ step }) => step === 'metrics')).toMatchObject({ finding: 'overviewTimedOut' });
            expect(state.checks.find(({ step }) => step === 'alerts')).toMatchObject({ finding: 'overviewRead' });
            expect(state.trace?.checkDurations).toMatchObject({ metrics: 6_000, alerts: 120 });
            expect(io.metricsList.mock.calls[0][1].abortSignal.aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps the API probe skipped for a saved non-NoSQL connection', async () => {
        const states = await diagnose({ ...attached, probe: 'network' });
        expect(io.get).not.toHaveBeenCalled();
        expect(io.readAll).not.toHaveBeenCalled();
        expect(states.at(-1)?.checks).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ finding: 'settingsNotApplicable' }),
                expect.objectContaining({ finding: 'apiProbeUnavailable', status: 'skipped' }),
                expect.objectContaining({ finding: 'privateDns' }),
            ]),
        );
    });
    it('rejects insecure cloud endpoints without sending credentials', async () => {
        const states = await diagnose({
            ...attached,
            account: {
                ...attached.account,
                connectionString: 'AccountEndpoint=http://example.test/;AccountKey=secret;',
            },
        });
        expect(io.readAll).not.toHaveBeenCalled();
        expect(states.at(-1)?.checks[0]).toMatchObject({ finding: 'invalidEndpoint' });
    });

    it('aborts an in-flight probe and disposes the client', async () => {
        const controller = new AbortController();
        io.fetchNext.mockImplementation(() => {
            controller.abort();
            return new Promise(() => {});
        });
        const states = await diagnose(attached, controller);
        expect(states.at(-1)?.phase).toBe('cancelled');
        expect(io.telemetry).toHaveBeenCalledWith(
            'cosmosDB.diagnostics.run',
            expect.objectContaining({
                properties: expect.objectContaining({ connectionOutcome: 'cancelled', result: 'Canceled' }),
            }),
        );
        expect(io.readAll.mock.calls[0][0].abortSignal.aborted).toBe(true);
        expect(io.dispose).toHaveBeenCalledTimes(2);
        expect(io.lookup).not.toHaveBeenCalled();
    });

    it('does not start a data-plane request after cancellation during credential resolution', async () => {
        const controller = new AbortController();
        io.get.mockResolvedValue({ documentEndpoint: 'https://example.test/', disableLocalAuth: true });
        io.getManagedIdentityAuth.mockImplementation(() => {
            controller.abort();
            return Promise.resolve(undefined);
        });

        expect((await diagnose(cloud, controller)).at(-1)?.phase).toBe('cancelled');
        expect(io.getCosmosClient).not.toHaveBeenCalled();
        expect(io.lookup).not.toHaveBeenCalled();
    });
});
