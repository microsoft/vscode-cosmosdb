/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type CreateMongoDatabaseWizardContext } from './CreateMongoDatabaseWizardContext';

export class MongoExecuteStep extends AzureWizardExecuteStep<CreateMongoDatabaseWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateMongoDatabaseWizardContext): Promise<void> {
        const credentialsId = context.credentialsId;
        const databaseName = context.databaseName!;
        const nodeId = context.nodeId;
        const client = await ClustersClient.getClient(credentialsId);

        return ext.state.showCreatingChild(
            nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: databaseName }),
            async () => {
                // Adding a delay to ensure the "creating child" animation is visible.
                // The `showCreatingChild` function refreshes the parent to show the
                // "creating child" animation and label. Refreshing the parent triggers its
                // `getChildren` method. If the database creation completes too quickly,
                // the dummy node with the animation might be shown alongside the actual
                // database entry, as it will already be available in the database.
                // Note to future maintainers: Do not remove this delay.
                await new Promise((resolve) => setTimeout(resolve, 250));
                await client.createDatabase(databaseName);
            },
        );
    }

    public shouldExecute(context: CreateMongoDatabaseWizardContext): boolean {
        return !!context.databaseName;
    }
}
