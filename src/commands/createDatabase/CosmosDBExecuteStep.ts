/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { getCosmosClient } from '../../cosmosdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';

export class CosmosDBExecuteStep extends AzureWizardExecuteStep<CreateDatabaseWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateDatabaseWizardContext): Promise<void> {
        const { endpoint, credentials, isEmulator } = context.accountInfo;
        const { databaseName, nodeId } = context;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

        return ext.state.showCreatingChild(
            nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: databaseName! }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));
                await cosmosClient.databases.create({ id: databaseName });
            },
        );
    }

    public shouldExecute(context: CreateDatabaseWizardContext): boolean {
        return !!context.databaseName;
    }
}
