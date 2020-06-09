/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, QueryResult } from "pg";
import { PostgresFunctionsTreeItem } from "./tree/PostgresFunctionsTreeItem";
import { PostgresResourcesTreeItemBase } from "./tree/PostgresResourcesTreeItemBase";

export interface IPostgresProceduresQueryRow {
    schema: string;
    name: string;
    oid: number;
    args: string;
    definition: string;
}

function getProceduresQuery(conditions: string): string {
    // Adapted from https://aka.ms/AA83fg8
    return `select n.nspname as schema,
        p.proname as name,
        p.oid as oid,
        pg_get_function_arguments(p.oid) as args,
        case when l.lanname = 'internal' then p.prosrc
            else pg_get_functiondef(p.oid)
            end as definition
        from pg_proc p
        left join pg_namespace n on p.pronamespace = n.oid
        left join pg_language l on p.prolang = l.oid
        where n.nspname not in ('pg_catalog', 'information_schema')
            ${conditions}
        order by name;`;
}

export async function getPostgresProcedureQueryRows(treeItem: PostgresResourcesTreeItemBase): Promise<IPostgresProceduresQueryRow[]> {
    let conditions: string;

    if (treeItem instanceof PostgresFunctionsTreeItem) {
        conditions = `and p.proname not in ('pg_buffercache_pages', 'pg_stat_statements_reset', 'pg_stat_statements')
        ${treeItem.parent.parent.supportsStoredProcedures() ? "and p.prokind = 'f'" : ''}`;
    } else {
        // Assume stored procedures
        conditions = "and p.prokind = 'p'";
    }

    const query: string = getProceduresQuery(conditions);
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
