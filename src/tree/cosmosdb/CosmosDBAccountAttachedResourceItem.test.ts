/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, RestError } from '@azure/cosmos';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CoreExperience } from '../../AzureDBExperiences';
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

describe('Attached emulator certificate errors', () => {
    let client: CosmosClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = new CosmosClient({
            endpoint: accountInfo.endpoint,
            key: Buffer.from('test-key').toString('base64'),
            connectionPolicy: { enableEndpointDiscovery: false },
        });
        vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
    });

    afterEach(() => {
        client.dispose();
        vi.restoreAllMocks();
    });

    function failRead(error: Error) {
        const iterator = client.databases.readAll();
        vi.spyOn(iterator, 'fetchAll').mockRejectedValue(error);
        vi.spyOn(client.databases, 'readAll').mockReturnValue(iterator);
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
    ])('does not misclassify unrelated errors: %s', async (error) => {
        failRead(error);

        await expect(new TestAccountResourceItem().getDatabases(accountInfo, client)).rejects.toBe(error);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('does not show emulator guidance for a normal account', async () => {
        const error = new RestError('untrusted', { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
        failRead(error);

        await expect(
            new TestAccountResourceItem(false).getDatabases({ ...accountInfo, isEmulator: false }, client),
        ).rejects.toBe(error);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
});
