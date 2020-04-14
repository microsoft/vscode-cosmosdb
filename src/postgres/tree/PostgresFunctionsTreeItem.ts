/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig, QueryResult } from 'pg';
import { AzureParentTreeItem, ISubscriptionContext, TreeItemIconPath } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresFunctionTreeItem } from "./PostgresFunctionTreeItem";

export interface IPostgresFunctionsQueryRow {
    schema: string;
    name: string;
    oid: number;
    definition: string;
}

export class PostgresFunctionsTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresFunctions';
    public readonly contextValue: string = PostgresFunctionsTreeItem.contextValue;
    public readonly label: string = 'Functions';
    public readonly childTypeLabel: string = 'Function';
    public readonly parent: PostgresDatabaseTreeItem;
    public clientConfig: ClientConfig;

    constructor(parent: PostgresDatabaseTreeItem, clientConfig: ClientConfig) {
        super(parent);
        this.clientConfig = clientConfig;
    }

    public get iconPath(): TreeItemIconPath {
        return getThemeAgnosticIconPath('Collection.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<PostgresFunctionTreeItem[]> {
        const client = new Client(this.clientConfig);
        await client.connect();

        // Adapted from https://aka.ms/AA83fg8
        const functionsQuery: string = `select n.nspname as schema,
            p.proname as name,
            p.oid as oid,
            case when l.lanname = 'internal' then p.prosrc
                else pg_get_functiondef(p.oid)
                end as definition
            from pg_proc p
            left join pg_namespace n on p.pronamespace = n.oid
            left join pg_language l on p.prolang = l.oid
            where n.nspname not in ('pg_catalog', 'information_schema')
                ${this.parent.parent.supportsStoredProcedures() ? "and p.prokind = 'f'" : '' /* Only select functions, not stored procedures */}
            order by name;`;

        const queryResult: QueryResult = await client.query(functionsQuery);
        const rows: IPostgresFunctionsQueryRow[] = queryResult.rows || [];

        const allNames: Set<string> = new Set();
        const duplicateNames: Set<string> = new Set();
        for (const row of rows) {
            if (allNames.has(row.name)) {
                duplicateNames.add(row.name);
            } else {
                allNames.add(row.name);
            }
        }

        return rows.map(row => new PostgresFunctionTreeItem(
            this,
            row,
            duplicateNames.has(row.name)
        ));
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        return contextValue === PostgresFunctionTreeItem.contextValue;
    }
}
