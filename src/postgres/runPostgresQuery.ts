/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig, QueryResult } from "pg";

/**
 * Runs and returns the result of a PostgreSQL query if one is provided.
 * Otherwise, establishes then ends a client connection to test if `clientConfig` is valid.
 */
export async function runPostgresQuery(clientConfig: ClientConfig, query?: string): Promise<QueryResult | undefined> {
    const client = new Client(clientConfig);
    try {
        await client.connect();
        return query ? await client.query(query) : undefined;
    } finally {
        await client.end();
    }
}
