/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, CosmosDiagnostics, FeedResponse, RestError } from '@azure/cosmos';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CoreExperience } from '../../AzureDBExperiences';
import { CosmosDBTimeouts } from '../../constants';
import { ext } from '../../extensionVariables';
import { TimeoutError } from '../../utils/timeout';
import { type CosmosDBAttachedAccountModel } from '../workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { type AccountInfo } from './AccountInfo';
import { CosmosDBAccountAttachedResourceItem } from './CosmosDBAccountAttachedResourceItem';

vi.mock('@microsoft/vscode-azext-utils', () => ({ createGenericElement: vi.fn() }));
vi.mock('../../cosmosdb/CosmosDBCredential', () => ({ getCosmosDBEntraIdCredential: vi.fn() }));
vi.mock('../../cosmosdb/utils/azureSessionHelper', () => ({ getSignedInPrincipalIdForAccountEndpoint: vi.fn() }));
vi.mock('../../cosmosdb/utils/rbacUtils', () => ({
    isRbacException: () => false,
    showRbacPermissionError: vi.fn(),
}));
vi.mock('../../cosmosdb/withClaimsChallengeHandling', () => ({ withClaimsChallengeHandling: vi.fn() }));
vi.mock('../../extensionVariables', () => ({
    ext: {
        settingsKeys: { connectionTimeout: 'cosmosDB.connectionTimeout' },
        outputChannel: { error: vi.fn() },
    },
}));
vi.mock('./AccountInfo', () => ({ getAccountInfo: vi.fn() }));

const account: CosmosDBAttachedAccountModel = {
    id: 'emulator',
    name: 'emulator',
    storageId: 'emulator',
    connectionString: '',
    isEmulator: true,
};
const accountInfo: AccountInfo = {
    id: account.id,
    name: account.name,
    endpoint: 'https://localhost:8081',
    credentials: [],
    isEmulator: true,
    isServerless: false,
};

class TestAccountResourceItem extends CosmosDBAccountAttachedResourceItem {
    constructor(isEmulator = true) {
        super({ ...account, isEmulator }, CoreExperience);
    }

    public override getDatabases(info: AccountInfo, client: CosmosClient) {
        return super.getDatabases(info, client);
    }

    protected async getChildrenImpl() {
        return [];
    }
}

describe('Attached account connection errors', () => {
    let client: CosmosClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = new CosmosClient({
            endpoint: accountInfo.endpoint,
            key: Buffer.from('test-key').toString('base64'),
            connectionPolicy: { enableEndpointDiscovery: false },
        });
        vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
        vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    });

    afterEach(() => {
        client.dispose();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function failRead(error: Error) {
        const iterator = client.databases.readAll();
        vi.spyOn(iterator, 'fetchAll').mockRejectedValue(error);
        vi.spyOn(client.databases, 'readAll').mockReturnValue(iterator);
    }

    function configureConnectionTimeout(value: unknown) {
        const configuration = vscode.workspace.getConfiguration();
        const get = vi.spyOn(configuration, 'get').mockReturnValue(value);
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(configuration);
        return get;
    }

    it.each([
        'DEPTH_ZERO_SELF_SIGNED_CERT',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    ])('offers trust guidance for %s and preserves the original error', async (code) => {
        const error = new RestError('certificate validation failed', { code });
        failRead(error);

        await expect(new TestAccountResourceItem().getDatabases(accountInfo, client)).rejects.toBe(error);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
            "Unable to verify a TLS certificate while connecting to the Cosmos DB emulator. Trust the emulator's certificate and, if using a proxy, its certificate authority in the environment where VS Code's extension host runs.",
            'Learn more',
        );
    });

    it.each([
        new RestError('unreachable', { code: 'ECONNREFUSED' }),
        new RestError('proxy TLS failed', { code: 'REQUEST_SEND_ERROR' }),
        new RestError('expired', { code: 'CERT_HAS_EXPIRED' }),
        new Error('DEPTH_ZERO_SELF_SIGNED_CERT'),
        new RestError('Connection timed out.', { code: 'ETIMEDOUT' }),
    ])('does not misclassify unrelated errors: %s', async (error) => {
        failRead(error);

        await expect(new TestAccountResourceItem().getDatabases(accountInfo, client)).rejects.toBe(error);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
    });

    it('does not show emulator guidance for a normal account', async () => {
        const error = new RestError('untrusted', { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
        failRead(error);

        await expect(
            new TestAccountResourceItem(false).getDatabases({ ...accountInfo, isEmulator: false }, client),
        ).rejects.toBe(error);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('allows remote account reads to complete after the former five-second deadline', async () => {
        vi.useFakeTimers();
        const iterator = client.databases.readAll();
        const response = new FeedResponse([], {}, false, new CosmosDiagnostics());
        vi.spyOn(iterator, 'fetchAll').mockImplementation(async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 9000));
            return response;
        });
        vi.spyOn(client.databases, 'readAll').mockReturnValue(iterator);
        const settled = vi.fn();

        const result = new TestAccountResourceItem(false).getDatabases({ ...accountInfo, isEmulator: false }, client);
        void result.then(settled, settled);
        await vi.advanceTimersByTimeAsync(6000);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(3000);
        await expect(result).resolves.toBe(response.resources);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
    });

    it('preserves a delayed remote SDK error instead of replacing it with a connection timeout', async () => {
        vi.useFakeTimers();
        const error = new RestError('service unavailable', { statusCode: 503 });
        const iterator = client.databases.readAll();
        vi.spyOn(iterator, 'fetchAll').mockImplementation(async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 9000));
            throw error;
        });
        vi.spyOn(client.databases, 'readAll').mockReturnValue(iterator);

        const result = new TestAccountResourceItem(false).getDatabases({ ...accountInfo, isEmulator: false }, client);
        const settled = vi.fn();
        void result.then(settled, settled);
        await vi.advanceTimersByTimeAsync(9000);

        await expect(result).rejects.toBe(error);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('times out a remote account read after thirty seconds', async () => {
        vi.useFakeTimers();
        const iterator = client.databases.readAll();
        vi.spyOn(iterator, 'fetchAll').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client.databases, 'readAll').mockReturnValue(iterator);
        const settled = vi.fn();

        const result = new TestAccountResourceItem(false).getDatabases({ ...accountInfo, isEmulator: false }, client);
        void result.then(settled, settled);
        await vi.advanceTimersByTimeAsync(29_999);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await expect(result).rejects.toThrow('Connection timed out.');
        await expect(result).rejects.toBeInstanceOf(TimeoutError);
        expect(ext.outputChannel.error).toHaveBeenCalledExactlyOnceWith(expect.any(TimeoutError));
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
            'Connection timed out. Please verify the connection string and that the host is reachable.',
            'Open Timeout Setting',
        );
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('retains the short emulator connection timeout', async () => {
        vi.useFakeTimers();
        configureConnectionTimeout(120);
        const iterator = client.databases.readAll();
        vi.spyOn(iterator, 'fetchAll').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client.databases, 'readAll').mockReturnValue(iterator);

        const result = new TestAccountResourceItem().getDatabases(accountInfo, client);
        const settled = vi.fn();
        void result.then(settled, settled);
        await vi.advanceTimersByTimeAsync(1000);

        await expect(result).rejects.toThrow('Unable to reach emulator.');
        expect(ext.outputChannel.error).toHaveBeenCalledExactlyOnceWith(expect.any(TimeoutError));
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('opens the connection timeout setting when the notification action is selected', async () => {
        vi.useFakeTimers();
        configureConnectionTimeout(1);
        vi.mocked(vscode.window.showErrorMessage).mockImplementation(vi.fn().mockResolvedValue('Open Timeout Setting'));
        const iterator = client.databases.readAll();
        vi.spyOn(iterator, 'fetchAll').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client.databases, 'readAll').mockReturnValue(iterator);

        const result = new TestAccountResourceItem(false).getDatabases({ ...accountInfo, isEmulator: false }, client);
        const settled = vi.fn();
        void result.then(settled, settled);
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).rejects.toBeInstanceOf(TimeoutError);

        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
            'workbench.action.openSettings',
            '@id:cosmosDB.connectionTimeout',
        );
    });

    it('does not wait for notification dismissal before reporting the tree error', async () => {
        vi.useFakeTimers();
        configureConnectionTimeout(1);
        vi.mocked(vscode.window.showErrorMessage).mockReturnValue(new Promise(() => {}));
        const iterator = client.databases.readAll();
        vi.spyOn(iterator, 'fetchAll').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client.databases, 'readAll').mockReturnValue(iterator);

        const result = new TestAccountResourceItem(false).getDatabases({ ...accountInfo, isEmulator: false }, client);
        const settled = vi.fn();
        void result.then(settled, settled);
        await vi.advanceTimersByTimeAsync(1000);
        await expect(result).rejects.toBeInstanceOf(TimeoutError);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledOnce();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('does not treat an SDK timeout message as the configured deadline', async () => {
        const error = new RestError('Connection timed out.', { code: 'ETIMEDOUT' });
        failRead(error);

        await expect(
            new TestAccountResourceItem(false).getDatabases({ ...accountInfo, isEmulator: false }, client),
        ).rejects.toBe(error);

        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(ext.outputChannel.error).not.toHaveBeenCalled();
    });

    it.each([5, 45, 120])('uses the configured remote timeout of %i seconds', async (seconds) => {
        vi.useFakeTimers();
        const get = configureConnectionTimeout(seconds);
        const iterator = client.databases.readAll();
        vi.spyOn(iterator, 'fetchAll').mockReturnValue(new Promise(() => {}));
        vi.spyOn(client.databases, 'readAll').mockReturnValue(iterator);
        const settled = vi.fn();

        const result = new TestAccountResourceItem(false).getDatabases({ ...accountInfo, isEmulator: false }, client);
        void result.then(settled, settled);
        await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await expect(result).rejects.toThrow('Connection timed out.');
        expect(get).toHaveBeenCalledWith('cosmosDB.connectionTimeout', 30);
    });

    it.each([undefined, null, 0, -1, 1.5, NaN, Infinity, '60', 2_147_484])(
        'falls back to thirty seconds for invalid remote timeout %s',
        (value) => {
            configureConnectionTimeout(value);

            expect(CosmosDBTimeouts.CONNECTION_TIMEOUT_MS).toBe(30_000);
        },
    );

    it('reads updated remote timeout settings without restarting the extension', () => {
        const get = configureConnectionTimeout(10);
        expect(CosmosDBTimeouts.CONNECTION_TIMEOUT_MS).toBe(10_000);

        get.mockReturnValue(60);
        expect(CosmosDBTimeouts.CONNECTION_TIMEOUT_MS).toBe(60_000);
        expect(CosmosDBTimeouts.EMULATOR_CONNECTION_TIMEOUT_MS).toBe(1000);
    });
});
