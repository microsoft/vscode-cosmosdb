/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { accountActionInput, buildAccountCostsUrl, runAccountAction } from './accountActions';

function dependencies() {
    const account = {
        id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/account',
    };
    const database = { id: `${account.id}/database` };
    return {
        account,
        database,
        accountId: account.id,
        resolveAccount: vi.fn().mockResolvedValue(account),
        resolveDatabase: vi.fn().mockResolvedValue(database),
        executeCommand: vi.fn().mockResolvedValue(undefined),
        openCosts: vi.fn().mockResolvedValue(undefined),
        openJson: vi.fn().mockResolvedValue(undefined),
    };
}

describe('account overview actions', () => {
    it.each([
        ['createDatabase', 'cosmosDB.createDatabase'],
        ['deleteAccount', 'cosmosDB.deleteAccount'],
    ] as const)('dispatches %s with the exact account to the existing command', async (action, command) => {
        const deps = dependencies();
        await runAccountAction({ action }, deps);
        expect(deps.executeCommand).toHaveBeenCalledWith(command, deps.account);
        expect(deps.resolveDatabase).not.toHaveBeenCalled();
    });

    it('creates a container only in a resolved database belonging to this account', async () => {
        const deps = dependencies();
        await runAccountAction({ action: 'createContainer', databaseId: 'database' }, deps);
        expect(deps.resolveDatabase).toHaveBeenCalledWith(deps.account, 'database');
        expect(deps.executeCommand).toHaveBeenCalledWith('cosmosDB.createContainer', deps.database);
    });

    it.each([undefined, { id: '/other-account' }])(
        'never runs a command for a missing or wrong account',
        async (node) => {
            const deps = dependencies();
            deps.resolveAccount.mockResolvedValue(node);
            await expect(runAccountAction({ action: 'deleteAccount' }, deps)).rejects.toThrow();
            expect(deps.executeCommand).not.toHaveBeenCalled();
        },
    );

    it.each([undefined, { id: '/other-account/database' }])(
        'never falls back to the global database picker',
        async (node) => {
            const deps = dependencies();
            deps.resolveDatabase.mockResolvedValue(node);
            await expect(
                runAccountAction({ action: 'createContainer', databaseId: 'database' }, deps),
            ).rejects.toThrow();
            expect(deps.executeCommand).not.toHaveBeenCalled();
        },
    );

    it.each(['openCosts', 'openJson'] as const)('opens %s without any resource picker', async (action) => {
        const deps = dependencies();
        await runAccountAction({ action }, deps);
        expect(deps[action]).toHaveBeenCalledOnce();
        expect(deps.resolveAccount).not.toHaveBeenCalled();
        expect(deps.executeCommand).not.toHaveBeenCalled();
    });

    it('propagates cancellation from the existing deletion wizard', async () => {
        const deps = dependencies();
        const cancellation = new Error('cancelled');
        deps.executeCommand.mockRejectedValue(cancellation);
        await expect(runAccountAction({ action: 'deleteAccount' }, deps)).rejects.toBe(cancellation);
        expect(deps.executeCommand).toHaveBeenCalledOnce();
    });

    it('rejects arbitrary commands, modeler, missing databases and path-like database identifiers', () => {
        for (const input of [
            { action: 'executeCommand', command: 'anything' },
            { action: 'dataModeler' },
            { action: 'createContainer' },
            { action: 'createContainer', databaseId: '' },
            { action: 'createContainer', databaseId: '../another/database' },
        ]) {
            expect(accountActionInput.safeParse(input).success).toBe(false);
        }
    });

    it.each(['https://portal.azure.com', 'https://portal.azure.us/', 'https://ms.portal.azure.com/'])(
        'opens Cost Analysis with the encoded account scope on %s',
        (portalUrl) => {
            const url = buildAccountCostsUrl(
                portalUrl,
                'tenant',
                '/subscriptions/sub/resourceGroups/my rg/providers/Microsoft.DocumentDb/databaseAccounts/account',
            );
            expect(url).toBe(
                `${portalUrl.replace(/\/$/, '')}/#@tenant/view/Microsoft_Azure_CostManagement/CostAnalysis/scope/%2Fsubscriptions%2Fsub%2FresourceGroups%2Fmy%20rg%2Fproviders%2FMicrosoft.DocumentDb%2FdatabaseAccounts%2Faccount`,
            );
        },
    );

    it('encodes tenant and scope without allowing them to add route segments', () => {
        const accountId =
            '/subscriptions/sub/resourceGroups/rg %23/providers/Microsoft.DocumentDB/databaseAccounts/account';
        const url = buildAccountCostsUrl('https://portal.azure.com/', 'tenant/name', accountId);
        expect(url).toContain('/#@tenant%2Fname/view/Microsoft_Azure_CostManagement/CostAnalysis/scope/');
        const scope = url.split('/scope/')[1];
        expect(scope).not.toContain('/');
        expect(decodeURIComponent(scope)).toBe(accountId);
    });
});
