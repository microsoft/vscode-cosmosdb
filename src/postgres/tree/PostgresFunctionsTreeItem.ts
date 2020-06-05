/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig, QueryResult } from 'pg';
import { TreeItemIconPath } from "vscode-azureextensionui";
import { getThemedIconPath } from "../../constants";
import { IPostgresProceduresQueryRow } from '../IPostgresProceduresQueryRow';
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresFunctionTreeItem } from "./PostgresFunctionTreeItem";
import { PostgresResourcesTreeItemBase } from './PostgresResourcesTreeItemBase';

export class PostgresFunctionsTreeItem extends PostgresResourcesTreeItemBase {
    public static contextValue: string = 'postgresFunctions';
    public readonly contextValue: string = PostgresFunctionsTreeItem.contextValue;
    public readonly label: string = 'Functions';
    public readonly childTypeLabel: string = 'Function';

    constructor(parent: PostgresDatabaseTreeItem, clientConfig: ClientConfig) {
        super(parent);
        this.clientConfig = clientConfig;
    }

    public get iconPath(): TreeItemIconPath {
        return getThemedIconPath('list-unordered.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<PostgresFunctionTreeItem[]> {
        const client = new Client(this.clientConfig);
        // Adapted from https://aka.ms/AA83fg8
        const functionsQuery: string = `select n.nspname as schema,
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
                and p.proname not in ('pg_buffercache_pages', 'pg_stat_statements_reset', 'pg_stat_statements')
                ${this.parent.parent.supportsStoredProcedures() ? "and p.prokind = 'f'" : '' /* Only select functions, not stored procedures */}
            order by name;`;
        let queryResult: QueryResult;

        try {
            await client.connect();
            queryResult = await client.query(functionsQuery);
        } finally {
            await client.end();
        }

        const rows: IPostgresProceduresQueryRow[] = queryResult.rows || [];

        this.resourcesAndSchemas = {};
        for (const row of rows) {
            this.addResourcesAndSchemasEntry(row.name, row.schema);
        }

        return rows.map(row => new PostgresFunctionTreeItem(
            this,
            row,
            this.isDuplicateResource(row.name)
        ));
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        return contextValue === PostgresFunctionTreeItem.contextValue;
    }
}
