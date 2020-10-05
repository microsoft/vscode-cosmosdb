/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from "pg";
import { runPostgresQuery, wrapArgInQuotes } from "./runPostgresQuery";

export interface IPostgresTable {
    schemaName: string;
    name: string;
    oid: number;
    columnNames: string[];
}

function getTableInfo(): string {
    return `select schemaname, tablename
            from pg_catalog.pg_tables
            where schemaname != 'pg_catalog' AND
            schemaname != 'information_schema'`;
}

function getTableOID(tableName: string): string {
    return `select oid from pg_class where relname = ${wrapArgInQuotes(tableName)}`;
}

function getColumnNames(tableName: string): string {
    return `select column_name as name
            from information_schema.columns
            where table_name = ${wrapArgInQuotes(tableName)}`;
}

export async function getTables(clientConfig: ClientConfig): Promise<IPostgresTable[]> {
    const tableInfoRows = await runPostgresQuery(clientConfig, getTableInfo());
    const tablesArray: IPostgresTable[] = [];
    for (const row of tableInfoRows.rows) {
        const schemaName = row.schemaname;
        const tableName = row.tablename;
        const tableOIDResult = await runPostgresQuery(clientConfig, getTableOID(tableName));
        const columnsResult = await runPostgresQuery(clientConfig, getColumnNames(tableName));
        tablesArray.push({ schemaName, name: tableName, oid: tableOIDResult.rows[0].oid, columnNames: columnsResult.rows.map(result => result.name) });
    }
    return tablesArray;
}
