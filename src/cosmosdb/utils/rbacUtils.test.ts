/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';

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

import { createCosmosDBManagementClient } from '../../utils/azureClients';
import {
    addRbacContributorPermission,
    isRbacException,
    showRbacPermissionError,
    withDataPlaneRbacRetry,
} from './rbacUtils';

describe('rbacUtils', () => {
    beforeEach(() => {
        // jest-mock-vscode returns a single shared mock instance for the whole test file, so
        // reset call history (and any spies) before each test to avoid leaking state between them.
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
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

        it('returns true for a structured 403/5301 Cosmos error', () => {
            expect(isRbacException(Object.assign(new Error('Forbidden'), { code: 403, substatus: 5301 }))).toBe(true);
        });

        it('reads the Cosmos substatus header when the property is absent', () => {
            expect(
                isRbacException(
                    Object.assign(new Error('Forbidden'), {
                        statusCode: 403,
                        headers: { 'X-MS-SUBSTATUS': '5301' },
                    }),
                ),
            ).toBe(true);
        });

        it.each([
            { code: 403, substatus: 5300, description: 'a different substatus' },
            { code: 401, substatus: 5301, description: 'a different status' },
            { code: 403, substatus: undefined, description: 'no substatus' },
        ])('returns false for $description', ({ code, substatus }) => {
            expect(isRbacException(Object.assign(new Error('Authorization failed'), { code, substatus }))).toBe(false);
        });
    });

    describe('withDataPlaneRbacRetry', () => {
        it('retries RBAC failures and returns the successful result', async () => {
            vi.useFakeTimers();
            const operation = vi
                .fn<() => Promise<string>>()
                .mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { code: 403, substatus: 5301 }))
                .mockResolvedValue('success');
            const onRetry = vi.fn();

            const result = withDataPlaneRbacRetry(operation, { onRetry });
            await vi.advanceTimersByTimeAsync(5_000);

            await expect(result).resolves.toBe('success');
            expect(operation).toHaveBeenCalledTimes(2);
            expect(onRetry).toHaveBeenCalledWith(1, 5_000);
        });

        it('does not retry unrelated errors', async () => {
            const error = new Error('Network failure');
            const operation = vi.fn<() => Promise<void>>().mockRejectedValue(error);

            await expect(withDataPlaneRbacRetry(operation)).rejects.toBe(error);
            expect(operation).toHaveBeenCalledTimes(1);
        });
    });

    describe('addRbacContributorPermission', () => {
        it('uses the v17 poller API with a stable role assignment ID', async () => {
            const pollUntilDone = vi.fn().mockResolvedValue({ id: 'assignment-resource-id' });
            const createUpdateSqlRoleAssignment = vi.fn().mockReturnValue({ pollUntilDone });
            vi.mocked(createCosmosDBManagementClient).mockResolvedValue({
                sqlResources: { createUpdateSqlRoleAssignment },
            } as never);
            const context = { valuesToMask: [] } as unknown as IActionContext;
            const subscription = {
                subscriptionId: 'subscription-id',
                name: 'Subscription',
            } as AzureSubscription;

            await addRbacContributorPermission('account', 'principal-id', 'resource-group', context, subscription);
            await addRbacContributorPermission('account', 'principal-id', 'resource-group', context, subscription);

            expect(createUpdateSqlRoleAssignment).toHaveBeenCalledTimes(2);
            expect(createUpdateSqlRoleAssignment.mock.calls[0][0]).toBe('resource-group');
            expect(createUpdateSqlRoleAssignment.mock.calls[0][1]).toBe('account');
            expect(createUpdateSqlRoleAssignment.mock.calls[0][2]).toBe(createUpdateSqlRoleAssignment.mock.calls[1][2]);
            expect(createUpdateSqlRoleAssignment.mock.calls[0][2]).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
            expect(pollUntilDone).toHaveBeenCalledTimes(2);
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
            vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue('Learn more' as never);
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
