/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PartitionKeyDefinitionVersion, PartitionKeyKind, type RequestOptions } from '@azure/cosmos';
import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { armCreateContainer, getArmAccountContext } from '../../cosmosdb/armControlPlane';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../extensionVariables';
import { type CreateContainerWizardContext } from './CreateContainerWizardContext';

export class CosmosDBExecuteStep extends AzureWizardExecuteStep<CreateContainerWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateContainerWizardContext): Promise<void> {
        const options: RequestOptions = {};
        const { endpoint, credentials, isEmulator } = context.accountInfo;
        const { containerName, partitionKey, throughput, databaseId, nodeId } = context;
        const armCtx = getArmAccountContext(context.accountInfo);

        if (throughput !== 0) {
            options.offerThroughput = throughput;
        }

        return ext.state.showCreatingChild(
            nodeId,
            l10n.t('Creating "{nodeName}"…', { nodeName: containerName! }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                const partitionKeyPaths = partitionKey?.paths ?? [];
                // Compare to MultiHash explicitly; the previous expression
                // `(partitionKey?.kind ?? paths.length > 1) ? MultiHash : Hash`
                // short-circuits on the truthy "Hash" string and would
                // incorrectly produce MultiHash whenever kind was Hash.
                const partitionKeyDefinition = {
                    paths: partitionKeyPaths,
                    kind:
                        partitionKey?.kind === PartitionKeyKind.MultiHash ||
                        (partitionKey?.kind === undefined && partitionKeyPaths.length > 1)
                            ? PartitionKeyKind.MultiHash
                            : PartitionKeyKind.Hash,
                    version: PartitionKeyDefinitionVersion.V2,
                };

                const containerDefinition = {
                    id: containerName,
                    partitionKey: partitionKeyDefinition,
                };

                if (armCtx) {
                    await armCreateContainer(armCtx, databaseId, containerDefinition, throughput);
                } else {
                    await withClaimsChallengeHandling(endpoint, credentials, isEmulator, async (cosmosClient) => {
                        await cosmosClient.database(databaseId).containers.create(containerDefinition, options);
                    });
                }
            },
        );
    }

    public shouldExecute(context: CreateContainerWizardContext): boolean {
        return !!context.containerName;
    }
}
