/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import type * as AzExtUtils from '@microsoft/vscode-azext-utils';
import { AzureWizard, UserCancelledError } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoreExperience } from '../../AzureDBExperiences';
import { armTestSubscription, createArmTestContext } from '../../cosmosdb/armTestUtils';
import { NoSqlAccountResourceItem } from '../../tree/nosql/NoSqlAccountResourceItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { DatabaseAccountDeleteStep } from './DatabaseAccountDeleteStep';
import { cosmosDBDeleteDatabaseAccount, deleteDatabaseAccount } from './deleteDatabaseAccount';
import { type DeleteAccountTarget } from './DeleteWizardContext';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@vscode/extension-telemetry', () => ({ default: class {} }));
vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof AzExtUtils>()),
    AzureWizard: vi.fn(
        class {
            execute = execute;
        },
    ),
}));
vi.mock('@microsoft/vscode-azureresources-api', () => ({
    AzExtResourceType: { AzureCosmosDb: 'AzureCosmosDb' },
}));
vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    createAuthorizationManagementClient: vi.fn(),
    getResourceGroupFromId: vi.fn(),
}));
vi.mock('@microsoft/vscode-azext-azureauth', () => ({ getSessionFromVSCode: vi.fn() }));
vi.mock('../../utils/azureClients', () => ({ createCosmosDBManagementClient: vi.fn() }));
vi.mock('../../utils/dialogs/getConfirmation', () => ({ getConfirmationAsInSettings: vi.fn() }));
vi.mock('../../utils/pickItem/pickAppResource', () => ({ pickAppResource: vi.fn() }));
vi.mock('./DatabaseAccountDeleteStep', () => ({ DatabaseAccountDeleteStep: class {} }));

describe('deleteDatabaseAccount', () => {
    const account: DeleteAccountTarget = {
        accountId:
            '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account-to-delete',
        accountName: 'account-to-delete',
        resourceGroup: 'rg',
        subscription: armTestSubscription,
    };

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(getResourceGroupFromId).mockReturnValue('rg');
    });

    it('uses the settings-aware confirmation with the account name before deleting', async () => {
        const context = createArmTestContext();
        vi.mocked(getConfirmationAsInSettings).mockImplementation(async () => {
            expect(execute).not.toHaveBeenCalled();
            expect(context.valuesToMask).toEqual(
                expect.arrayContaining([
                    account.accountId,
                    account.accountName,
                    account.resourceGroup,
                    account.subscription.subscriptionId,
                ]),
            );
            return true;
        });

        await deleteDatabaseAccount(context, account);

        expect(getConfirmationAsInSettings).toHaveBeenCalledExactlyOnceWith(
            'Delete Database Account "account-to-delete"',
            'Are you sure you want to delete account "account-to-delete" and its contents?',
            'account-to-delete',
        );
        expect(AzureWizard).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ account }), {
            title: 'Delete Database Account "account-to-delete"',
            executeSteps: [expect.any(DatabaseAccountDeleteStep)],
        });
        expect(execute).toHaveBeenCalledOnce();
        expect(pickAppResource).not.toHaveBeenCalled();
        expect(vi.mocked(AzureWizard).mock.calls[0][0]).not.toHaveProperty('node');
    });

    it('reports a declined confirmation as cancellation without deleting', async () => {
        vi.mocked(getConfirmationAsInSettings).mockResolvedValue(false);

        await expect(deleteDatabaseAccount(createArmTestContext(), account)).rejects.toBeInstanceOf(UserCancelledError);

        expect(AzureWizard).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('propagates a dismissed word prompt without deleting', async () => {
        const cancellation = new UserCancelledError();
        vi.mocked(getConfirmationAsInSettings).mockRejectedValue(cancellation);

        await expect(deleteDatabaseAccount(createArmTestContext(), account)).rejects.toBe(cancellation);

        expect(execute).not.toHaveBeenCalled();
    });

    it('propagates deletion failures rather than reporting success', async () => {
        const failure = new Error('Deletion failed');
        vi.mocked(getConfirmationAsInSettings).mockResolvedValue(true);
        execute.mockRejectedValue(failure);

        await expect(deleteDatabaseAccount(createArmTestContext(), account)).rejects.toBe(failure);
    });

    it.each([false, true])('keeps the Explorer adapter as metadata extraction, picker=%s', async (usePicker) => {
        const node = new NoSqlAccountResourceItem(
            {
                id: account.accountId,
                name: account.accountName,
                type: 'microsoft.documentdb/databaseaccounts',
                subscription: account.subscription,
                azureResourceType: { type: 'microsoft.documentdb/databaseaccounts' },
                raw: {},
            },
            CoreExperience,
        );
        vi.mocked(pickAppResource).mockResolvedValueOnce(node);
        vi.mocked(getConfirmationAsInSettings).mockResolvedValueOnce(true);
        await cosmosDBDeleteDatabaseAccount(createArmTestContext(), usePicker ? undefined : node);
        expect(AzureWizard).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ account }), {
            title: 'Delete Database Account "account-to-delete"',
            executeSteps: [expect.any(DatabaseAccountDeleteStep)],
        });
        expect(pickAppResource).toHaveBeenCalledTimes(Number(usePicker));
        expect(getResourceGroupFromId).toHaveBeenCalledExactlyOnceWith(account.accountId);
        expect(execute).toHaveBeenCalledOnce();
    });
});
