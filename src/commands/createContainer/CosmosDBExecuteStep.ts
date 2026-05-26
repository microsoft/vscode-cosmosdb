/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { getControlPlane } from '../../cosmosdb/controlPlane';
import { ext } from '../../extensionVariables';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

export class CosmosDBExecuteStep extends AzureWizardExecuteStep<CreateContainerWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateContainerWizardContext): Promise<void> {
        const { containerName, partitionKey, throughput, maxThroughput, databaseId, nodeId } = context;

        return ext.state.showCreatingChild(
            nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: containerName! }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));
                const controlPlane = getControlPlane(context.accountInfo);
                await controlPlane.createContainer(
                    databaseId,
                    {
                        id: containerName,
                        partitionKey,
                    },
                    throughput,
                    maxThroughput,
                );
            },
        );
    }

    public shouldExecute(context: CreateContainerWizardContext): boolean {
        return !!context.containerName;
    }
}
