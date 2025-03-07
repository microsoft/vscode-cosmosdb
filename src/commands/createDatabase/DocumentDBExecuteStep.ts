/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';

export class DocumentDBExecuteStep extends AzureWizardExecuteStep<CreateDatabaseWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateDatabaseWizardContext): Promise<void> {
        const { endpoint, credentials, isEmulator } = context.accountInfo;
        const { databaseName, nodeId } = context;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

        return ext.state.showCreatingChild(nodeId, vscode.l10n.t(`Creating "{0}"...`, databaseName!), async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));
            await cosmosClient.databases.create({ id: databaseName });
        });
    }

    public shouldExecute(context: CreateDatabaseWizardContext): boolean {
        return !!context.databaseName;
    }
}
