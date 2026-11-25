/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AccountDiagnosticsTarget } from '../../connectionDiagnostics/target';
import { isTreeElementWithContextValue } from '../TreeElementWithContextValue';
import { isCosmosDBAttachedAccountModel } from '../workspace-view/cosmosdb/CosmosDBAttachedAccountModel';
import { isAzureCosmosDBAccount } from './models/CosmosDBAccountModel';

export const cosmosDBConnectionTargetContext = 'cosmosDBConnectionTarget';

export function getConnectionDiagnosticsTarget(element: unknown): AccountDiagnosticsTarget | undefined {
    if (
        !isTreeElementWithContextValue(element) ||
        typeof element.contextValue !== 'string' ||
        !('account' in element)
    ) {
        return undefined;
    }
    const tags = element.contextValue.split(';');
    if (!tags.includes(cosmosDBConnectionTargetContext)) return undefined;

    const { account } = element;
    const probe = tags.includes('treeItem.account') && tags.includes('experience.Core') ? 'nosql' : 'network';
    if (isAzureCosmosDBAccount(account)) return { kind: 'azure', account, probe };
    if (isCosmosDBAttachedAccountModel(account)) {
        return { kind: account.isEmulator ? 'emulator' : 'attached', account, probe };
    }
    return undefined;
}
