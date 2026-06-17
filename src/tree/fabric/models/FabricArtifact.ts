/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IArtifact } from '@microsoft/vscode-fabric-api';
import { type FabricArtifactType } from '../../../constants';

export interface FabricArtifact extends IArtifact {
    /**
     * The ID of this resource.
     *
     * @remarks Needs for BaseCachedBranchDataProvider. This value should be unique across all resources.
     */
    id: string;
    /**
     * The display name of this resource.
     * @remarks Needs for BaseCachedBranchDataProvider
     */
    name: string;
    /**
     * Narrowed artifact type to only two appropriated for us
     */
    type: FabricArtifactType;
}
