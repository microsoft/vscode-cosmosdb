/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PartitionKeyDefinitionVersion, PartitionKeyKind, type RequestOptions } from '@azure/cosmos';
import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

export class DocumentDBExecuteStep extends AzureWizardExecuteStep<CreateContainerWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateContainerWizardContext): Promise<void> {
        const options: RequestOptions = {};
        const { endpoint, credentials, isEmulator } = context.accountInfo;
        const { containerName, partitionKey, throughput, databaseId, nodeId } = context;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);

        if (throughput !== 0) {
            options.offerThroughput = throughput;
        }

        return ext.state.showCreatingChild(nodeId, `Creating "${containerName}"...`, async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));

            const partitionKeyDefinition = {
                paths: partitionKey?.paths ?? [],
                kind:
                    (partitionKey?.kind ?? (partitionKey?.paths?.length ?? 0) > 1)
                        ? PartitionKeyKind.MultiHash // Multi-hash partition key if there are sub-partitions
                        : PartitionKeyKind.Hash, // Hash partition key if there is only one partition
                version: PartitionKeyDefinitionVersion.V2,
            };

            const containerDefinition = {
                id: containerName,
                partitionKey: partitionKeyDefinition,
            };

            await cosmosClient.database(databaseId).containers.create(containerDefinition, options);
        });
    }

    public shouldExecute(context: CreateContainerWizardContext): boolean {
        return !!context.containerName;
    }
}
