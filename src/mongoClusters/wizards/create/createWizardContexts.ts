/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type DatabaseItem } from '../../tree/DatabaseItem';

export interface CreateCollectionWizardContext extends IActionContext {
    /** These values have to be provided for the wizard to function correctly. */
    credentialsId: string;
    databaseItem: DatabaseItem;

    /** These values will be populated by the wizard. */
    newCollectionName?: string;
}

export interface CreateDatabaseWizardContext extends IActionContext {
    /** These values have to be provided for the wizard to function correctly. */
    credentialsId: string;
    clusterName: string;

    /** These values will be populated by the wizard. */
    newDatabaseName?: string;
}
