/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { validateDatabaseName } from '../../cosmosdb/utils/validateResourceName';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { promptResourceNameOrDataModeler } from '../dataModeling/promptResourceNameOrDataModeler';
import { validateDatabaseNameAvailable } from './CosmosDBDatabaseNameStep';

export type DatabaseCreationChoice = { kind: 'manual'; databaseName: string } | { kind: 'dataModeler' };

export async function promptDatabaseNameOrDataModeler(accountInfo: AccountInfo): Promise<DatabaseCreationChoice> {
    const choice = await promptResourceNameOrDataModeler({
        title: l10n.t('Create database'),
        placeholder: l10n.t('Enter a database name'),
        detail: l10n.t('Type a name to create a database manually.'),
        createLabel: (name) => l10n.t('Create database "{name}"', { name }),
        validateName: validateDatabaseName,
        validateNameAvailable: (name) => validateDatabaseNameAvailable(accountInfo, name),
    });
    return choice.kind === 'manual' ? { kind: 'manual', databaseName: choice.name } : choice;
}
