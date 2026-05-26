/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ArtifactConnectionInfo } from '../../../services/FabricService';
import { type CosmosDBItemsModel } from '../../cosmosdb/models/CosmosDBItemsModel';

export type FabricItemsModel = CosmosDBItemsModel & {
    artifactConnectionInfo: ArtifactConnectionInfo;
};
