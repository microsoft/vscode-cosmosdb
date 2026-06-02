/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { armCreateDatabase, getArmAccountContext } from '../../cosmosdb/armControlPlane';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { type CreateDatabaseWizardContext } from './CreateDatabaseWizardContext';

export class CosmosDBExecuteStep extends AzureWizardExecuteStep<CreateDatabaseWizardContext> {
    public id = 'cosmosDB.createDatabase.executeStep';
    public priority: number = 100;

    public async execute(context: CreateDatabaseWizardContext): Promise<void> {
        const { endpoint, credentials, isEmulator } = context.accountInfo;
        const { databaseName, nodeId } = context;
        const armCtx = getArmAccountContext(context.accountInfo);

        return ext.state.showCreatingChild(
            nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: databaseName! }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                if (armCtx) {
                    await armCreateDatabase(armCtx, databaseName!);
                } else {
                    await withClaimsChallengeHandling(endpoint, credentials, isEmulator, async (cosmosClient) => {
                        await cosmosClient.databases.create({ id: databaseName });
                    });
                }
            },
        );
    }

    public shouldExecute(context: CreateDatabaseWizardContext): boolean {
        return !!context.databaseName;
    }
}
