/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, QueryResult } from 'pg';
import { Uri } from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { PostgresFunctionTreeItem } from "./PostgresFunctionTreeItem";
import { PostgresSchemaTreeItem } from "./PostgresSchemaTreeItem";

export class PostgresFunctionsTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresFunctions';
    public readonly contextValue: string = PostgresFunctionsTreeItem.contextValue;
    public readonly label: string = 'Functions';
    public readonly childTypeLabel: string = 'Function';
    public readonly parent: PostgresSchemaTreeItem;

    constructor(parent: PostgresSchemaTreeItem) {
        super(parent);
    }

    public get iconPath(): string | Uri | { light: string | Uri; dark: string | Uri } {
        return getThemeAgnosticIconPath('Collection.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<PostgresFunctionTreeItem[]> {
        const client = new Client(this.parent.clientConfig);
        await client.connect();

        // Adapted from https://aka.ms/AA83fg8
        const functionsQuery: string = `select p.proname as name,
            case when l.lanname = 'internal' then p.prosrc
                else pg_get_functiondef(p.oid)
                end as definition
            from pg_proc p
            left join pg_namespace n on p.pronamespace = n.oid
            left join pg_language l on p.prolang = l.oid
            where n.nspname not in ('pg_catalog', 'information_schema')
                and n.nspname = '${this.parent.schema.name}'
                ${this.supportsStoredProcedures() ? "and p.prokind = 'f'" : '' /* Only select functions, not stored procedures */}
            order by name;`;

        const queryResult: QueryResult = await client.query(functionsQuery);
        const rows: { name: string, definition: string }[] = queryResult.rows || [];
        return rows.map(row => new PostgresFunctionTreeItem(this, row.name, row.definition));
    }

    private supportsStoredProcedures(): boolean {
        const version: string | undefined = this.parent.parent.parent.server.version;
        return !!version && parseFloat(version) >= 11;
    }
}
