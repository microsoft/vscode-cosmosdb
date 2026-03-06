/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { type ArtifactConnectionInfo } from '../../../services/FabricService';
import { type AccountInfo } from '../../cosmosdb/AccountInfo';
import { type DatabaseResource } from '../../cosmosdb/models/CosmosDBTypes';
import { type TreeElement } from '../../TreeElement';
import { FabricArtifactResourceItem } from '../FabricArtifactResourceItem';
import { type FabricArtifact } from '../models/FabricArtifact';
import { FabricMirroredDatabaseResourceItem } from './FabricMirroredDatabaseResourceItem';

export class FabricMirroredArtifactResourceItem extends FabricArtifactResourceItem {
    constructor(
        public readonly context: vscode.ExtensionContext,
        public readonly artifact: FabricArtifact,
        experience: Experience,
    ) {
        super(context, artifact, experience);
    }

    protected async getResources(
        artifactConnectionInfo: ArtifactConnectionInfo,
        cosmosClient: CosmosClient,
    ): Promise<DatabaseResource[]> | never {
        if (artifactConnectionInfo.type === 'MIRRORED_KEY') {
            const databaseIdsSet = new Set<string>();

            for (const collectionResourceId in artifactConnectionInfo.resourceTokens) {
                // Dictionary key looks like this: dbs/SampleDB/colls/Container
                const resourceIdObj = collectionResourceId.split('/');

                if (resourceIdObj.length !== 4) {
                    throw new Error(
                        l10n.t('Error while querying databases') +
                            ': ' +
                            l10n.t('Resource key not recognized: {resourceIdObj}', { resourceIdObj: 'ReadDatabases' }),
                    );
                }

                const databaseId = resourceIdObj[1];

                databaseIdsSet.add(databaseId);
            }

            return Array.from(databaseIdsSet.values()).map((databaseId) => ({
                _rid: '',
                _self: '',
                _etag: '',
                _ts: 0,
                id: databaseId,
            }));
        }

        if (artifactConnectionInfo.type === 'MIRRORED_AAD') {
            const result = await cosmosClient.databases.readAll().fetchAll();
            return result.resources;
        }

        return [];
    }

    protected async getChildrenImpl(
        accountInfo: AccountInfo,
        artifactConnectionInfo: ArtifactConnectionInfo,
        databases: DatabaseResource[],
    ): Promise<TreeElement[]> {
        return databases.map(
            (database) =>
                new FabricMirroredDatabaseResourceItem(
                    this.context,
                    { accountInfo, artifactConnectionInfo, database },
                    this.experience,
                ),
        );
    }
}
