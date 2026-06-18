/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

import { isRbacException, showRbacPermissionError } from './rbacUtils';

describe('rbacUtils', () => {
    beforeEach(() => {
        // jest-mock-vscode returns a single shared mock instance for the whole test file, so
        // reset call history (and any spies) before each test to avoid leaking state between them.
        vi.restoreAllMocks();
        vi.clearAllMocks();
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
            const showErrorMessage = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as never);

            await showRbacPermissionError('my-account');

            expect(showErrorMessage).toHaveBeenCalledTimes(1);
            const message = showErrorMessage.mock.calls[0][0] as string;
            expect(message).toContain('my-account');
        });

        it('includes the principal id in the message when provided', async () => {
            const showErrorMessage = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as never);

            await showRbacPermissionError('my-account', 'principal-42');

            const message = showErrorMessage.mock.calls[0][0] as string;
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
            vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined as never);
            const openExternal = vi.fn().mockResolvedValue(true);
            (vscode as unknown as { env: { openExternal: typeof openExternal } }).env = { openExternal };

            await showRbacPermissionError('my-account');

            expect(openExternal).not.toHaveBeenCalled();
        });
    });
});
