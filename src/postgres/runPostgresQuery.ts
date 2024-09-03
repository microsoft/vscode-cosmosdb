/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type ClientConfig, type QueryResult } from 'pg';
import { Client } from 'pg';

export async function runPostgresQuery(clientConfig: ClientConfig, query: string): Promise<QueryResult> {
    const client: Client = new Client(clientConfig);
    try {
        await client.connect();
        return await client.query(query);
    } finally {
        await client.end();
    }
}
export function wrapArgInQuotes(input: string): string {
    return `"${input}"`;
}
