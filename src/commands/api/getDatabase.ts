/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBDatabase } from '../../vscode-cosmosdb.api';

export async function getDatabase(connectionString: CosmosDBDatabase): Promise<CosmosDBDatabase> {
    if (connectionString) {
        throw new Error('Not implemented yet.');
    }
    return undefined;
}
