/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig, QueryResult } from "pg";

export async function runPostgresQuery(clientConfig: ClientConfig, query: string): Promise<QueryResult> {
    const client: Client = new Client(clientConfig);
    try {
        await client.connect();
        return await client.query(query);
    } finally {
        await client.end();
    }
}
