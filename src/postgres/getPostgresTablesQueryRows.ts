/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from "pg";
import { runPostgresQuery } from "./runPostgresQuery";

export interface IPostgresTable {
    schemaName: string;
    name: string;
    columnNames: string[];
}

function getTableInfo(): string {
    return `select schemaname, tablename, array_agg (columnname) as columnarray
            from pg_catalog.pg_tables
            left join (select column_name::text as columnname, table_name, table_schema from information_schema.columns) columns on table_name = tablename and table_schema = schemaname
            where schemaname != 'pg_catalog' AND
            schemaname != 'information_schema'
            group by schemaname, tablename;`;
}

export async function getTables(clientConfig: ClientConfig): Promise<IPostgresTable[]> {
    const tableInfoRows = await runPostgresQuery(clientConfig, getTableInfo());
    const tablesArray: IPostgresTable[] = [];
    for (const row of tableInfoRows.rows) {
        tablesArray.push({ schemaName: row.schemaname, name: row.tablename, columnNames: row.columnarray });
    }
    return tablesArray;
}
