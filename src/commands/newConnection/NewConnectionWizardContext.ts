/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import type ConnectionString from 'mongodb-connection-string-url';
import { type Experience } from '../../AzureDBExperiences';
import { type ParsedCosmosDBConnectionString } from '../../cosmosdb/cosmosDBConnectionStrings';
import { type QuickPickType } from '../../utils/pickItem/pickExperience';

export interface NewConnectionWizardContext extends IActionContext {
    quickPickType: QuickPickType;
    parentId: string;

    experience?: Experience;
    connectionString?: string;
    parsedConnectionString?: URL | ConnectionString | ParsedCosmosDBConnectionString;

    username?: string;
    password?: string;
}
