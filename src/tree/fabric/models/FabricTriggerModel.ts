/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ArtifactConnectionInfo } from '../../../services/FabricService';
import { type CosmosDBTriggerModel } from '../../cosmosdb/models/CosmosDBTriggerModel';

export type FabricTriggerModel = CosmosDBTriggerModel & {
    artifactConnectionInfo: ArtifactConnectionInfo;
};
