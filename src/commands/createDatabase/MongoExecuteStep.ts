/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { MongoClustersClient } from '../../mongoClusters/MongoClustersClient';
import { localize } from '../../utils/localize';
import { type CreateMongoDatabaseWizardContext } from './CreateMongoDatabaseWizardContext';

export class MongoExecuteStep extends AzureWizardExecuteStep<CreateMongoDatabaseWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateMongoDatabaseWizardContext): Promise<void> {
        const credentialsId = context.credentialsId;
        const databaseName = context.databaseName!;
        const nodeId = context.nodeId;
        const client = await MongoClustersClient.getClient(credentialsId);

        return ext.state.showCreatingChild(
            nodeId,
            localize('mongoClusters.tree.creating', 'Creating "{0}"...', databaseName),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));
                await client.createDatabase(databaseName);
            },
        );
    }

    public shouldExecute(context: CreateMongoDatabaseWizardContext): boolean {
        return !!context.databaseName;
    }
}
