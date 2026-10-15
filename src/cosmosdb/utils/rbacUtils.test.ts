/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHttpHeaders, type PipelineResponse } from '@azure/core-rest-pipeline';
import * as vscode from 'vscode';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { armTestSubscription, createArmTestClient, createArmTestContext } from '../armTestUtils';

// The module statically imports heavy azext barrels (which transitively `require('vscode')`
// from CJS telemetry deps). None of them are exercised by the pure guards / message helper
// under test, so stub them out.
vi.mock('@microsoft/vscode-azext-azureutils', () => ({
    createAuthorizationManagementClient: vi.fn(),
    getResourceGroupFromId: vi.fn(),
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
    createSubscriptionContext: vi.fn(),
}));
vi.mock('../../utils/azureClients', () => ({
    createCosmosDBManagementClient: vi.fn(),
}));

import { addRbacContributorPermission, isRbacException, showRbacPermissionError } from './rbacUtils';

describe('rbacUtils', () => {
    beforeEach(() => {
        // jest-mock-vscode returns a single shared mock instance for the whole test file, so
        // reset call history (and any spies) before each test to avoid leaking state between them.
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('creates the role assignment in the correct scope and waits for the final ARM result', async () => {
        const client = createArmTestClient();
        vi.mocked(createCosmosDBManagementClient).mockResolvedValue(client);
        const completed = Promise.withResolvers<void>();
        const polling = Promise.withResolvers<void>();
        const send = vi.spyOn(client.pipeline, 'sendRequest').mockImplementation(async (_httpClient, request) => {
            if (request.url.includes('/operations/role')) {
                polling.resolve();
                await completed.promise;
                return {
                    request,
                    status: 200,
                    headers: createHttpHeaders(),
                    bodyAsText: JSON.stringify({ id: 'assignment-id', properties: { provisioningState: 'Succeeded' } }),
                };
            }
            throw new Error('Unexpected request');
        });
        send.mockImplementationOnce((_httpClient, request): Promise<PipelineResponse> =>
            Promise.resolve({
                request,
                status: 202,
                headers: createHttpHeaders({
                    location: 'https://management.azure.com/operations/role',
                    'retry-after': '0',
                }),
            }),
        );

        const result = addRbacContributorPermission(
            'account',
            'principal',
            'rg',
            createArmTestContext(),
            armTestSubscription,
        );
        const settled = vi.fn();
        void result.then(settled);
        await polling.promise;
        expect(settled).not.toHaveBeenCalled();
        expect(send.mock.calls[0][1].url).toMatch(
            /\/resourceGroups\/rg\/providers\/Microsoft.DocumentDB\/databaseAccounts\/account\/sqlRoleAssignments\/[0-9a-f-]{36}\?/,
        );
        expect(send.mock.calls[0][1].body).toBe(
            JSON.stringify({
                properties: {
                    roleDefinitionId:
                        '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002',
                    scope: '/subscriptions/sub-1/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account',
                    principalId: 'principal',
                },
            }),
        );
        completed.resolve();
        await expect(result).resolves.toBe('assignment-id');
    });

    describe('isRbacException', () => {
        it('returns true when the error message mentions the required RBAC permission', () => {
            const error = new Error(
                'Request blocked by Auth myaccount : Request does not have required RBAC permissions to perform action',
            );
            expect(isRbacException(error)).toBe(true);
        });

        it('returns false for unrelated errors', () => {
            expect(isRbacException(new Error('Some other failure'))).toBe(false);
        });

        it('returns false for an empty error message', () => {
            expect(isRbacException(new Error(''))).toBe(false);
        });
    });

    describe('showRbacPermissionError', () => {
        it('shows an error message that includes the account name', async () => {
            const showErrorMessage = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

            await showRbacPermissionError('my-account');

            expect(showErrorMessage).toHaveBeenCalledTimes(1);
            const message = showErrorMessage.mock.calls[0][0];
            expect(message).toContain('my-account');
        });

        it('includes the principal id in the message when provided', async () => {
            const showErrorMessage = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

            await showRbacPermissionError('my-account', 'principal-42');

            const message = showErrorMessage.mock.calls[0][0];
            expect(message).toContain('my-account');
            expect(message).toContain('principal-42');
        });

        it('opens the learn-more link when the user selects "Learn more"', async () => {
            const stringMessageWindow: {
                showErrorMessage(
                    message: string,
                    options: vscode.MessageOptions,
                    ...items: string[]
                ): Thenable<string | undefined>;
            } = vscode.window;
            vi.spyOn(stringMessageWindow, 'showErrorMessage').mockResolvedValue('Learn more');
            const openExternal = vi.fn().mockResolvedValue(true);
            (vscode as unknown as { env: { openExternal: typeof openExternal } }).env = { openExternal };

            await showRbacPermissionError('my-account');

            expect(openExternal).toHaveBeenCalledTimes(1);
            expect(openExternal.mock.calls[0][0].toString()).toContain('aka.ms/cosmos-native-rbac');
        });

        it('does not open any link when the user dismisses the message', async () => {
            vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
            const openExternal = vi.fn().mockResolvedValue(true);
            (vscode as unknown as { env: { openExternal: typeof openExternal } }).env = { openExternal };

            await showRbacPermissionError('my-account');

            expect(openExternal).not.toHaveBeenCalled();
        });
    });
});
