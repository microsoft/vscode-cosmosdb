/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { validateContainerName } from '../../cosmosdb/utils/validateResourceName';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { promptResourceNameOrDataModeler } from '../dataModeling/promptResourceNameOrDataModeler';
import { validateContainerNameAvailable } from './CosmosDBContainerNameStep';

export async function promptContainerNameOrDataModeler(accountInfo: AccountInfo, databaseId: string, value = '') {
    return promptResourceNameOrDataModeler({
        title: l10n.t('Create container'),
        placeholder: l10n.t('Enter a container name for {databaseId}', { databaseId }),
        detail: l10n.t('Type a name to create a container manually.'),
        createLabel: (name) => l10n.t('Create container "{name}"', { name }),
        validateName: validateContainerName,
        validateNameAvailable: (name) => validateContainerNameAvailable(accountInfo, databaseId, name),
        value,
    });
}
