/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, QueryResult } from "pg";
import { IPostgresProceduresQueryRow } from "./IPostgresProceduresQueryRow";
import { PostgresResourcesTreeItemBase } from "./tree/PostgresResourcesTreeItemBase";

export async function getPostgresProcedureQueryRows(treeItem: PostgresResourcesTreeItemBase, query: string): Promise<IPostgresProceduresQueryRow[]> {
    const client = new Client(treeItem.clientConfig);
    let queryResult: QueryResult;

    try {
        await client.connect();
        queryResult = await client.query(query);
    } finally {
        await client.end();
    }

    const rows: IPostgresProceduresQueryRow[] = queryResult.rows || [];

    treeItem.resourcesAndSchemas = {};
    for (const row of rows) {
        treeItem.addResourcesAndSchemasEntry(row.name, row.schema);
    }

    return rows;
}
