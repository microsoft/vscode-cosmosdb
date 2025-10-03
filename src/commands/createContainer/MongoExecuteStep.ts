/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type CreateCollectionWizardContext } from './CreateCollectionWizardContext';

export class MongoExecuteStep extends AzureWizardExecuteStep<CreateCollectionWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateCollectionWizardContext): Promise<void> {
        const collectionName = context.newCollectionName!;
        const databaseName = context.databaseId;
        const client = await ClustersClient.getClient(context.credentialsId);

        return ext.state.showCreatingChild(
            context.nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: collectionName }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));
                await client.createCollection(databaseName, collectionName);
            },
        );
    }

    public shouldExecute(context: CreateCollectionWizardContext): boolean {
        return !!context.newCollectionName;
    }
}
