/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type ArtifactTreeNode, type IFabricTreeNodeProvider } from '@microsoft/vscode-fabric-api';
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

    public async createArtifactTreeNode(artifact: FabricArtifact): Promise<ArtifactTreeNode> {
        const treeElement = await this.getResourceItem(artifact);
        return new FabricArtifactTreeNodeProxy(this.context, artifact, treeElement);
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

        if (type.toLocaleLowerCase() === 'CosmosDBDatabase'.toLocaleLowerCase()) {
            return new FabricNativeArtifactResourceItem(this.context, resource, FabricNativeExperience);
        }

        if (type.toLocaleLowerCase() === 'MirroredDatabase'.toLocaleLowerCase()) {
            return new FabricMirroredArtifactResourceItem(this.context, resource, FabricMirroredExperience);
        }

        throw new Error(l10n.t('Unsupported resource type'));
    }

    protected onResourceItemRetrieved() {
        // No additional actions needed after retrieving the resource item
    }
}
