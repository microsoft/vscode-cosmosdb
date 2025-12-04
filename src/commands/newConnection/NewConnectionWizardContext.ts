/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Experience } from '../../AzureDBExperiences';
import { type ParsedCosmosDBConnectionString } from '../../cosmosdb/cosmosDBConnectionStrings';

export interface NewConnectionWizardContext extends IActionContext {
    parentId: string;

    experience?: Experience;
    connectionString?: string;
    parsedConnectionString?: URL | ParsedCosmosDBConnectionString;

    username?: string;
    password?: string;
}
