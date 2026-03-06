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
import { FabricNativeDatabaseResourceItem } from './FabricNativeDatabaseResourceItem';

export class FabricNativeArtifactResourceItem extends FabricArtifactResourceItem {
    constructor(
        public readonly context: vscode.ExtensionContext,
        public readonly artifact: FabricArtifact,
        experience: Experience,
    ) {
        super(context, artifact, experience);
    }

    protected getResources(
        artifactConnectionInfo: ArtifactConnectionInfo,
        _cosmosClient: CosmosClient,
    ): Promise<DatabaseResource[]> | never {
        const databaseName = artifactConnectionInfo.databaseName;
        if (!databaseName) {
            throw new Error(l10n.t('Database name is missing in artifact connection info'));
        }

        return Promise.resolve([
            {
                _rid: '',
                _self: '',
                _etag: '',
                _ts: 0,
                id: databaseName,
            },
        ]);
    }

    protected async getChildrenImpl(
        accountInfo: AccountInfo,
        artifactConnectionInfo: ArtifactConnectionInfo,
        databases: DatabaseResource[],
    ): Promise<TreeElement[]> {
        return databases.map(
            (database) =>
                new FabricNativeDatabaseResourceItem(
                    this.context,
                    { accountInfo, artifactConnectionInfo, database },
                    this.experience,
                ),
        );
    }
}
