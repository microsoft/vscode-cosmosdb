/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBItem } from '../../vscode-cosmosdb.api';

export async function getDatabase(connectionString: CosmosDBItem): Promise<CosmosDBItem> {
    if (connectionString) {
        throw new Error('Not implemented yet.');
    }
    return undefined;
}
