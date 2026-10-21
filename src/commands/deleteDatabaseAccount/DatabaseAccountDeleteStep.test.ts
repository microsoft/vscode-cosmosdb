/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { armTestSubscription, createArmTestClient, createArmTestContext } from '../../cosmosdb/armTestUtils';
import { createActivityContextV2 } from '../../utils/activityUtils';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { DatabaseAccountDeleteStep } from './DatabaseAccountDeleteStep';
import { type DeleteWizardContext } from './DeleteWizardContext';

const mocks = vi.hoisted(() => ({
    refresh: vi.fn(),
    appendLog: vi.fn(),
    showDeleting: vi.fn(async (_id: string, action: () => Promise<void>) => action()),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({ AzureWizardExecuteStep: class {} }));
vi.mock('../../extensionVariables', () => ({
    ext: {
        state: { showDeleting: mocks.showDeleting },
        cosmosDBBranchDataProvider: {
            refresh: mocks.refresh,
            findNodeById: () => {
                throw new Error('Deleting an account must not look up Explorer nodes.');
            },
            getResourceItem: () => {
                throw new Error('Deleting an account must not reconstruct Explorer nodes.');
            },
        },
        outputChannel: { appendLog: mocks.appendLog },
    },
}));
vi.mock('../../utils/activityUtils', () => ({ createActivityContextV2: vi.fn() }));
vi.mock('../../utils/azureClients', () => ({ createCosmosDBManagementClient: vi.fn() }));

function deleteContext(): DeleteWizardContext {
    return {
        ...createArmTestContext(),
        account: {
            accountId:
                '/subscriptions/sub-1/resourceGroups/resource-group/providers/Microsoft.DocumentDB/databaseAccounts/account',
            accountName: 'account',
            resourceGroup: 'resource-group',
            subscription: {
                ...armTestSubscription,
                environment: { ...armTestSubscription.environment, portalUrl: 'https://portal.azure.us/' },
            },
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createActivityContextV2).mockResolvedValue({
        registerActivity: vi.fn(),
        suppressNotification: true,
    });
});

describe('DatabaseAccountDeleteStep without a node', () => {
    it.each([false, true])(
        'awaits account deletion before refreshing Explorer, notifications suppressed=%s',
        async (suppressNotification) => {
            const client = createArmTestClient();
            vi.mocked(createCosmosDBManagementClient).mockResolvedValue(client);
            vi.mocked(createActivityContextV2).mockResolvedValue({
                registerActivity: vi.fn(),
                suppressNotification,
            });
            const finished = Promise.withResolvers<void>();
            const send = vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_httpClient, request) => {
                await finished.promise;
                return { request, status: 204, headers: createHttpHeaders() };
            });
            vi.spyOn(vscode.window, 'withProgress').mockImplementation(async (_options, task) =>
                task({ report: vi.fn() }, new vscode.CancellationTokenSource().token),
            );
            vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
            const context = deleteContext();
            const settled = vi.fn();
            const pending = new DatabaseAccountDeleteStep().execute(context).then(settled);
            await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
            expect(settled).not.toHaveBeenCalled();
            expect(mocks.refresh).not.toHaveBeenCalled();
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
            const request = send.mock.calls[0][1];
            expect(request.method).toBe('DELETE');
            expect(new URL(request.url).pathname).toBe(context.account.accountId);
            expect(createCosmosDBManagementClient).toHaveBeenCalledWith(
                expect.anything(),
                context.account.subscription,
            );
            expect(mocks.showDeleting).toHaveBeenCalledExactlyOnceWith(context.account.accountId, expect.any(Function));

            finished.resolve();
            await pending;
            expect(settled).toHaveBeenCalledOnce();
            expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith();
            expect(vscode.window.withProgress).toHaveBeenCalledTimes(Number(!suppressNotification));
            expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(Number(!suppressNotification));
            expect(mocks.appendLog).toHaveBeenCalledTimes(Number(!suppressNotification));
        },
    );

    it('propagates ARM errors without success messages or a success refresh', async () => {
        const client = createArmTestClient();
        vi.mocked(createCosmosDBManagementClient).mockResolvedValue(client);
        vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_httpClient, request) => ({
            request,
            status: 403,
            headers: createHttpHeaders({ 'content-type': 'application/json' }),
            bodyAsText: JSON.stringify({ error: { code: 'Forbidden', message: 'Deletion denied' } }),
        }));
        await expect(new DatabaseAccountDeleteStep().execute(deleteContext())).rejects.toThrow('Deletion denied');
        expect(mocks.refresh).not.toHaveBeenCalled();
        expect(mocks.appendLog).not.toHaveBeenCalled();
    });
});
