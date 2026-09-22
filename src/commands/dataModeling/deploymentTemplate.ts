/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PartitionKeyKind } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import {
    DeploymentTemplateInputSchema,
    getPartitionKeyPaths,
    validateDeploymentDatabaseName,
    type DeploymentTemplateInput,
} from '../../dataModeling/deploymentModel';
import { type CosmosModel } from '../../panels/migration/cosmosModel';
import { type ContainerResource } from '../../tree/cosmosdb/models/CosmosDBTypes';
import { CosmosDBContainerNameStep } from '../createContainer/CosmosDBContainerNameStep';

/** Adapt the recommendation to the same model consumed by migration provisioning and Bicep generation. */
export function createDeploymentModel(input: DeploymentTemplateInput): CosmosModel {
    if (!DeploymentTemplateInputSchema.safeParse(input).success) {
        throw new Error(l10n.t('Select a database and at least one valid container to deploy.'));
    }
    const databaseError = validateDeploymentDatabaseName(input.databaseName);
    if (databaseError) throw new Error(databaseError);
    const names = new Set<string>();
    const validator = new CosmosDBContainerNameStep();
    return {
        version: 1,
        domain: '',
        databaseName: input.databaseName,
        containers: input.containers.map(({ entity, partitionKey }) => {
            if (
                !entity.trim() ||
                entity !== entity.trim() ||
                validator.validateInput(entity) ||
                entity.includes('%') ||
                entity.split('').some((character) => character.charCodeAt(0) < 32) ||
                entity === '.' ||
                entity === '..' ||
                names.has(entity)
            ) {
                throw new Error(l10n.t('Select containers with valid, distinct names.'));
            }
            names.add(entity);
            const paths = getPartitionKeyPaths(partitionKey);
            if (
                paths.length > 3 ||
                new Set(paths).size !== paths.length ||
                paths.some((path) => path.length > 255 || !/^\/[^/\s,]+(?:\/[^/\s,]+)*$/.test(path))
            ) {
                throw new Error(
                    l10n.t('Each container needs one to three distinct partition key paths starting with "/".'),
                );
            }
            return { name: entity, entities: [], partitionKeys: paths.map((path) => ({ path })) };
        }),
    };
}

/** Preserve existing containers rather than redeploying their policies, throughput, or legacy partition-key version. */
export function missingContainers(model: CosmosModel, existing: ContainerResource[]): CosmosModel {
    return {
        ...model,
        containers: model.containers.filter((container) => {
            const current = existing.find((candidate) => candidate.id === container.name);
            if (!current) return true;
            const paths = container.partitionKeys?.map((key) => key.path) ?? ['/id'];
            const expectedKind = paths.length > 1 ? PartitionKeyKind.MultiHash : PartitionKeyKind.Hash;
            if (
                !current.partitionKey ||
                (current.partitionKey.kind ?? PartitionKeyKind.Hash) !== expectedKind ||
                current.partitionKey.paths.length !== paths.length ||
                current.partitionKey.paths.some((path, index) => path !== paths[index])
            ) {
                throw new Error(
                    l10n.t(
                        'Container "{container}" already exists with a different partition key. Choose another database or change the model. Existing containers are not modified.',
                        { container: container.name },
                    ),
                );
            }
            return false;
        }),
    };
}
