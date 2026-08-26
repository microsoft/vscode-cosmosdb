/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AccountInfo } from '../tree/cosmosdb/AccountInfo';
import { type ContainerResource, type DatabaseResource } from '../tree/cosmosdb/models/CosmosDBTypes';

/**
 * The node shape the shell launch flow actually receives. `cosmosDB.launchCosmosDBShell` is
 * contributed on both database and container tree items, so `container` is absent for
 * database-scoped launches; both are optional so every access has to be guarded.
 */
export type CosmosDBShellLaunchNode = {
    model: {
        accountInfo: AccountInfo;
        database?: DatabaseResource;
        container?: ContainerResource;
    };
};
