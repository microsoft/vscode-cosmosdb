/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type ArtifactTreeNode, type IArtifact, type IFabricTreeNodeProvider } from '@microsoft/vscode-fabric-api';
import * as l10n from '@vscode/l10n';
import type vscode from 'vscode';
import { FabricMirroredExperience, FabricNativeExperience } from '../../AzureDBExperiences';
import { type FabricArtifactType } from '../../constants';
import { nonNullProp } from '../../utils/nonNull';
import { BaseCachedBranchDataProvider } from '../BaseCachedBranchDataProvider';
import { FabricMirroredArtifactResourceItem } from '../fabric/mirrored/FabricMirroredArtifactResourceItem';
import { type FabricArtifact } from '../fabric/models/FabricArtifact';
import { FabricNativeArtifactResourceItem } from '../fabric/native/FabricNativeArtifactResourceItem';
import { FabricArtifactTreeNodeProxy } from '../fabric/proxy/FabricArtifactTreeNodeProxy';
import { bindTreeElement } from '../mixins/toTreeItem';
import { type TreeElement } from '../TreeElement';

export class FabricTreeNodeProvider
    extends BaseCachedBranchDataProvider<FabricArtifact>
    implements IFabricTreeNodeProvider
{
    constructor(
        public readonly context: vscode.ExtensionContext,
        public readonly artifactType: FabricArtifactType,
    ) {
        super();
    }

    public async createArtifactTreeNode(artifact: IArtifact): Promise<ArtifactTreeNode> {
        const fabricArtifact = this.toFabricArtifact(artifact);
        const treeElement = await this.getResourceItem(fabricArtifact);
        const fabricNode = new FabricArtifactTreeNodeProxy(this.context, fabricArtifact, treeElement);

        return await bindTreeElement(fabricNode, treeElement);
    }

    protected get contextValue(): string {
        return 'cosmosDB.fabric';
    }

    protected createResourceItem(context: IActionContext, resource: FabricArtifact): TreeElement {
        const id = nonNullProp(resource, 'id');
        const name = nonNullProp(resource, 'displayName');
        const type = nonNullProp(resource, 'type');

        context.valuesToMask.push(id);
        context.valuesToMask.push(name);

        if (type === 'CosmosDBDatabase') {
            return new FabricNativeArtifactResourceItem(this.context, resource, FabricNativeExperience);
        }

        if (type === 'MirroredDatabase') {
            return new FabricMirroredArtifactResourceItem(this.context, resource, FabricMirroredExperience);
        }

        throw new Error(l10n.t('Unsupported resource type'));
    }

    protected onResourceItemRetrieved() {
        // No additional actions needed after retrieving the resource item
    }

    protected toFabricArtifact(artifact: IArtifact): FabricArtifact {
        if (artifact.type !== 'CosmosDBDatabase' && artifact.type !== 'MirroredDatabase') {
            throw new Error(l10n.t('Unsupported artifact type'));
        }

        return {
            ...artifact,
            id: nonNullProp(artifact, 'id'),
            name: nonNullProp(artifact, 'displayName'),
            type: nonNullProp(artifact, 'type') as FabricArtifactType,
        };
    }
}
