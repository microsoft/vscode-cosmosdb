/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ArtifactConnectionInfo } from '../../../services/FabricService';
import { type CosmosDBItemModel } from '../../cosmosdb/models/CosmosDBItemModel';

export type FabricItemModel = CosmosDBItemModel & {
    artifactConnectionInfo: ArtifactConnectionInfo;
};
