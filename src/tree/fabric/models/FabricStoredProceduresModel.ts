/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ArtifactConnectionInfo } from '../../../services/FabricService';
import { type CosmosDBStoredProceduresModel } from '../../cosmosdb/models/CosmosDBStoredProceduresModel';

export type FabricStoredProceduresModel = CosmosDBStoredProceduresModel & {
    artifactConnectionInfo: ArtifactConnectionInfo;
};
