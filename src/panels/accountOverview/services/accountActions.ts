/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { z } from 'zod';

export const accountActionInput = z.discriminatedUnion('action', [
    z.object({ action: z.literal('createDatabase') }),
    z.object({
        action: z.literal('createContainer'),
        databaseId: z
            .string()
            .min(1)
            .regex(/^[^/\\?#]+$/),
    }),
    z.object({ action: z.literal('deleteAccount') }),
    z.object({ action: z.literal('openCosts') }),
    z.object({ action: z.literal('openJson') }),
]);

export type AccountActionInput = z.infer<typeof accountActionInput>;

interface ActionNode {
    id: string;
}

export interface AccountActionDependencies<T extends ActionNode> {
    accountId: string;
    resolveAccount: () => Promise<T | undefined>;
    resolveDatabase: (account: T, databaseId: string) => Promise<T | undefined>;
    executeCommand: (command: string, node: T) => Promise<unknown>;
    openCosts: () => Promise<unknown>;
    openJson: () => Promise<unknown>;
}

/** Uses existing registered wizards, including DeleteConfirmationStep; never falls back to an unscoped picker. */
export async function runAccountAction<T extends ActionNode>(
    input: AccountActionInput,
    dependencies: AccountActionDependencies<T>,
): Promise<void> {
    if (input.action === 'openCosts') {
        await dependencies.openCosts();
        return;
    }
    if (input.action === 'openJson') {
        await dependencies.openJson();
        return;
    }

    const account = await dependencies.resolveAccount();
    if (!account || account.id.toLowerCase() !== dependencies.accountId.toLowerCase()) {
        throw new Error(l10n.t('Unable to resolve this account in the Azure Resources view.'));
    }

    if (input.action === 'createContainer') {
        const database = await dependencies.resolveDatabase(account, input.databaseId);
        if (!database || database.id !== `${account.id}/${input.databaseId}`) {
            throw new Error(l10n.t('Unable to resolve the selected database in this account.'));
        }
        await dependencies.executeCommand('cosmosDB.createContainer', database);
    } else {
        await dependencies.executeCommand(
            input.action === 'createDatabase' ? 'cosmosDB.createDatabase' : 'cosmosDB.deleteAccount',
            account,
        );
    }
}

export function buildAccountCostsUrl(portalUrl: string, tenantId: string, accountId: string): string {
    const resourcePath = accountId.split('/').map(encodeURIComponent).join('/');
    return `${portalUrl.replace(/\/$/, '')}/#@${encodeURIComponent(tenantId)}/resource${resourcePath}/costanalysis`;
}
