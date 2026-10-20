/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as AzExtUtils from '@microsoft/vscode-azext-utils';
import { AzureWizard, UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { DatabaseAccountDeleteStep } from './DatabaseAccountDeleteStep';
import { cosmosDBDeleteDatabaseAccount } from './deleteDatabaseAccount';

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
vi.mock('../../utils/dialogs/getConfirmation', () => ({ getConfirmationAsInSettings: vi.fn() }));
vi.mock('../../utils/pickItem/pickAppResource', () => ({ pickAppResource: vi.fn() }));
vi.mock('./DatabaseAccountDeleteStep', () => ({ DatabaseAccountDeleteStep: class {} }));

describe('cosmosDBDeleteDatabaseAccount', () => {
    const account = { account: { name: 'account-to-delete' } } as CosmosDBAccountResourceItem;

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('uses the settings-aware confirmation with the account name before deleting', async () => {
        const context = {} as IActionContext;
        vi.mocked(getConfirmationAsInSettings).mockImplementation(async () => {
            expect(execute).not.toHaveBeenCalled();
            return true;
        });

        await cosmosDBDeleteDatabaseAccount(context, account);

        expect(getConfirmationAsInSettings).toHaveBeenCalledExactlyOnceWith(
            'Delete Database Account "account-to-delete"',
            'Are you sure you want to delete account "account-to-delete" and its contents?',
            'account-to-delete',
        );
        expect(AzureWizard).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ node: account }), {
            title: 'Delete Database Account "account-to-delete"',
            executeSteps: [expect.any(DatabaseAccountDeleteStep)],
        });
        expect(execute).toHaveBeenCalledOnce();
        expect(pickAppResource).not.toHaveBeenCalled();
    });

    it('reports a declined confirmation as cancellation without deleting', async () => {
        vi.mocked(getConfirmationAsInSettings).mockResolvedValue(false);

        await expect(cosmosDBDeleteDatabaseAccount({} as IActionContext, account)).rejects.toBeInstanceOf(
            UserCancelledError,
        );

        expect(AzureWizard).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('propagates a dismissed word prompt without deleting', async () => {
        const cancellation = new UserCancelledError();
        vi.mocked(getConfirmationAsInSettings).mockRejectedValue(cancellation);

        await expect(cosmosDBDeleteDatabaseAccount({} as IActionContext, account)).rejects.toBe(cancellation);

        expect(execute).not.toHaveBeenCalled();
    });

    it('propagates deletion failures rather than reporting success', async () => {
        const failure = new Error('Deletion failed');
        vi.mocked(getConfirmationAsInSettings).mockResolvedValue(true);
        execute.mockRejectedValue(failure);

        await expect(cosmosDBDeleteDatabaseAccount({} as IActionContext, account)).rejects.toBe(failure);
    });
});
