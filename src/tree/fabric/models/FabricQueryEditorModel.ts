/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ArtifactConnectionInfo } from '../../../services/FabricService';
import { type CosmosDBQueryEditorModel } from '../../cosmosdb/models/CosmosDBQueryEditorModel';

export type FabricQueryEditorModel = CosmosDBQueryEditorModel & {
    artifactConnectionInfo: ArtifactConnectionInfo;
};
