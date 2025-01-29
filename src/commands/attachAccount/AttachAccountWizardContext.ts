/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import type ConnectionString from 'mongodb-connection-string-url';
import { type Experience } from '../../AzureDBExperiences';
import { type ParsedDocDBConnectionString } from '../../docdb/docDBConnectionStrings';

export interface AttachAccountWizardContext extends IActionContext {
    experience: Experience;
    parentId: string;
    connectionString?: string;
    parsedConnectionString?: URL | ConnectionString | ParsedDocDBConnectionString;

    username?: string;
    password?: string;
}
