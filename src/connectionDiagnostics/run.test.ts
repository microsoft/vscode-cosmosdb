/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod, getPreferredAuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { type DiagnosticsState } from './model';
import { type DiagnosticsTarget, runDiagnostics } from './run';

const io = vi.hoisted(() => ({
    fetchNext: vi.fn(),
    readAll: vi.fn(),
    dispose: vi.fn(),
    get: vi.fn(),
    listReadOnlyKeys: vi.fn(),
    listKeys: vi.fn(),
    lookup: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));
vi.mock('../cosmosdb/getCosmosClient', () => ({
    getCosmosClient: () => ({ databases: { readAll: io.readAll }, dispose: io.dispose }),
}));
vi.mock('../cosmosdb/AuthenticationMethod', { spy: true });
vi.mock('../utils/azureClients', () => ({
    createCosmosDBManagementClient: () => Promise.resolve({ databaseAccounts: io }),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: (
        _name: string,
        run: (context: { errorHandling: object; telemetry: object; valuesToMask: string[] }) => unknown,
    ) => run({ errorHandling: {}, telemetry: {}, valuesToMask: [] }),
}));

const attached: DiagnosticsTarget = {
    kind: 'attached',
    account: {
        id: 'attachment',
        storageId: 'storage',
        name: 'Saved account',
        connectionString: 'AccountEndpoint=https://example.test/;AccountKey=secret;',
        isEmulator: false,
    },
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
        io.fetchNext.mockResolvedValue({});
        io.readAll.mockReturnValue({ fetchNext: io.fetchNext });
        io.lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
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
        const cloud: DiagnosticsTarget = {
            kind: 'azure',
            account: {
                id: 'resource',
                name: 'account',
                resourceGroup: 'group',
                subscription: { subscriptionId: 'subscription', tenantId: 'tenant' },
                raw: {},
            } as Extract<DiagnosticsTarget, { kind: 'azure' }>['account'],
        };
        const states = await diagnose(cloud);
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
        expect(io.readAll.mock.calls[0][0].abortSignal.aborted).toBe(true);
        expect(io.dispose).toHaveBeenCalledOnce();
        expect(io.lookup).not.toHaveBeenCalled();
    });
});
