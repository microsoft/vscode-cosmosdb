/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ArtifactConnectionInfo } from '../../../services/FabricService';
import { type CosmosDBTriggersModel } from '../../cosmosdb/models/CosmosDBTriggersModel';

export type FabricTriggersModel = CosmosDBTriggersModel & {
    artifactConnectionInfo: ArtifactConnectionInfo;
};
