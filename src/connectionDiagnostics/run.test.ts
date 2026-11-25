/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHttpHeaders, createPipelineRequest } from '@azure/core-rest-pipeline';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod, getPreferredAuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { type GetCosmosClientOptions } from '../cosmosdb/getCosmosClient';
import { type DiagnosticsState } from './model';
import { renderReport } from './presentation';
import { type DiagnosticsTarget, runDiagnostics } from './run';

const io = vi.hoisted(() => ({
    fetchNext: vi.fn(),
    readAll: vi.fn(),
    dispose: vi.fn(),
    get: vi.fn(),
    listReadOnlyKeys: vi.fn(),
    listKeys: vi.fn(),
    lookup: vi.fn(),
    getCosmosClient: vi.fn(),
    log: vi.fn(),
    telemetry: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));
vi.mock('../cosmosdb/getCosmosClient', () => ({
    getCosmosClient: io.getCosmosClient,
}));
vi.mock('../extensionVariables', () => ({ ext: { outputChannel: { info: io.log } } }));
vi.mock('../cosmosdb/AuthenticationMethod', { spy: true });
vi.mock('../utils/azureClients', () => ({
    createCosmosDBManagementClient: () => Promise.resolve({ databaseAccounts: io }),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
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

const attached: DiagnosticsTarget = {
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
        id: 'resource',
        name: 'account',
        resourceGroup: 'group',
        subscription: { subscriptionId: 'subscription', tenantId: 'tenant' },
        raw: {},
    } as Extract<DiagnosticsTarget, { kind: 'azure' }>['account'],
};

async function diagnose(target: DiagnosticsTarget, controller = new AbortController()) {
    const states: DiagnosticsState[] = [];
    await runDiagnostics(target, controller.signal, (state) => states.push(state));
    return states;
}

describe('diagnosing a NoSQL connection', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(getPreferredAuthenticationMethod).mockReturnValue(AuthenticationMethod.auto);
        io.getCosmosClient.mockReturnValue({ databases: { readAll: io.readAll }, dispose: io.dispose });
        io.fetchNext.mockResolvedValue({});
        io.readAll.mockReturnValue({ fetchNext: io.fetchNext });
        io.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
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
                    measurements: { durationMs: expect.any(Number), checkCount: 4 },
                }),
            ],
        ]);
        expect(local).toContain(
            'sdk target=alternate operation=listDatabases status=403 substatus=1000 endpoint=https://regional.example.test',
        );
        expect(report).toContain('Check log');
        expect(report).toContain(`Run ID: ${state.trace?.runId}`);
        expect(report).toContain('sdk target=alternate operation=listDatabases status=403 substatus=1000');
        expect(report).toContain('check=dns status=info');
        expect(report).toContain('finished phase=completed');
        expect(local).not.toMatch(/secret=query|sensitive-auth-header|raw-response/);
        expect(report + JSON.stringify(runEvents)).not.toMatch(
            /(?:configured|regional)\.example\.test|secret=query|sensitive-auth-header|raw-response/,
        );
    });

    it('uses a bounded, read-only SDK operation and never treats auxiliary DNS as authoritative', async () => {
        io.lookup.mockRejectedValue(new Error('name could not be resolved locally'));
        const states = await diagnose(attached);
        expect(io.get).not.toHaveBeenCalled();
        expect(io.readAll).toHaveBeenCalledExactlyOnceWith({ maxItemCount: 1, abortSignal: expect.any(AbortSignal) });
        expect(io.fetchNext).toHaveBeenCalledOnce();
        expect(io.dispose).toHaveBeenCalledOnce();
        expect(states.at(-1)).toMatchObject({
            phase: 'completed',
            checks: [
                { finding: 'endpointReady' },
                { finding: 'settingsNotApplicable' },
                { finding: 'connected', auth: 'key' },
                { finding: 'unresolvedDns', status: 'info' },
            ],
        });
        expect(JSON.stringify(states)).not.toContain('secret');
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
        ]);
        expect(io.listReadOnlyKeys).not.toHaveBeenCalled();
        expect(io.listKeys).not.toHaveBeenCalled();
        expect(states.at(-1)).toMatchObject({
            checks: [
                { finding: 'endpointReady' },
                { network: { publicAccess: 'disabled', ipRules: 1, privateEndpoints: 1 } },
                { finding: 'firewallPrivateEndpoint', auth: 'entra' },
                { finding: 'privateDns' },
            ],
        });
        expect(JSON.stringify(states)).not.toContain('203.0.113.45');
    });

    it('runs ARM and DNS checks without retrieving credentials or sending a NoSQL request for other APIs', async () => {
        io.get.mockResolvedValue({
            documentEndpoint: 'https://example.test/',
            publicNetworkAccess: 'Disabled',
        });
        const states = await diagnose({ ...cloud, probe: 'network' });
        expect(io.get).toHaveBeenCalledOnce();
        expect(io.listReadOnlyKeys).not.toHaveBeenCalled();
        expect(io.listKeys).not.toHaveBeenCalled();
        expect(io.readAll).not.toHaveBeenCalled();
        expect(io.lookup).toHaveBeenCalledExactlyOnceWith('example.test', { all: true });
        expect(states.at(-1)).toMatchObject({
            phase: 'completed',
            checks: [
                { finding: 'endpointReady' },
                { finding: 'settingsRead', network: { publicAccess: 'disabled' } },
                { finding: 'apiProbeUnavailable', status: 'skipped' },
                { finding: 'privateDns' },
            ],
        });
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
        expect(io.dispose).toHaveBeenCalledOnce();
        expect(io.lookup).not.toHaveBeenCalled();
    });
});
