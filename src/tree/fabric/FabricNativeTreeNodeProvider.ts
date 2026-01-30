/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import {
    ArtifactTreeNode,
    type FabricTreeNode,
    type IArtifact,
    type IFabricTreeNodeProvider,
} from '@microsoft/vscode-fabric-api';
import * as l10n from '@vscode/l10n';
import { v4 as uuid } from 'uuid';
import type vscode from 'vscode';
import { type Experience, FabricNativeExperience } from '../../AzureDBExperiences';
import { FabricArtifactType, getThemeAgnosticIconPath } from '../../constants';
import { type TreeElementFabric } from '../TreeElementFabric';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';

export class FabricNativeTreeNodeProvider implements IFabricTreeNodeProvider {
    public readonly identity: string = 'fabric.native-tree-node-provider';
    public readonly artifactType = FabricArtifactType.NATIVE;

    constructor(private context: vscode.ExtensionContext) {}

    createArtifactTreeNode(artifact: IArtifact): Promise<ArtifactTreeNode> {
        return Promise.resolve(new FabricNativeArtifactTreeNode(this.context, artifact, FabricNativeExperience, this));
    }
}

/**
 * Artifact tree node represents a Database in Cosmos DB hierarchy.
 */
export class FabricNativeArtifactTreeNode
    extends ArtifactTreeNode
    implements TreeElementFabric, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.database';
    public readonly experience: Experience;
    public readonly dataProvider: IFabricTreeNodeProvider;

    constructor(
        context: vscode.ExtensionContext,
        artifact: IArtifact,
        experience: Experience,
        dataProvider: IFabricTreeNodeProvider,
    ) {
        super(context, artifact);

        this.id = artifact.id ?? uuid();
        this.experience = experience;
        this.dataProvider = dataProvider;
        this.contextValue = createContextValue([this.contextValue ?? '', `experience.${this.experience.api}`]);

        this.iconPath = getThemeAgnosticIconPath('CosmosDBAccount.svg');
        this.label = this.artifact.displayName || l10n.t('Cosmos DB Artifact');
        this.description = this.artifact.description || '';
    }

    async getChildNodes(): Promise<FabricTreeNode[]> {
        // const pathTemplate = `/metadata/artifacts/${this.artifact.id}`;
        // const options: IApiClientRequestOptions = {
        //     method: 'GET',
        //     pathTemplate: pathTemplate,
        // };
        //
        // const fullArtifact = await ext.fabricServices.apiClient.sendRequest(options);
        // if (fullArtifact) {
        //     console.log('Fetched full artifact for children:', fullArtifact);
        // }
        return [];
    }
}
