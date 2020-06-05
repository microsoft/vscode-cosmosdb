/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from 'pg';
import { TreeItemIconPath } from "vscode-azureextensionui";
import { getThemedIconPath } from "../../constants";
import { getPostgresProcedureQueryRows } from '../getPostgresProcedureQueryRows';
import { IPostgresProceduresQueryRow } from '../IPostgresProceduresQueryRow';
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresResourcesTreeItemBase } from './PostgresResourcesTreeItemBase';
import { PostgresStoredProcedureTreeItem } from './PostgresStoredProcedureTreeItem';

export class PostgresStoredProceduresTreeItem extends PostgresResourcesTreeItemBase {
    public static contextValue: string = 'postgresStoredProcedures';
    public readonly contextValue: string = PostgresStoredProceduresTreeItem.contextValue;
    public readonly label: string = 'Stored Procedures';
    public readonly childTypeLabel: string = 'Stored Procedure';

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

    public async loadMoreChildrenImpl(): Promise<PostgresStoredProcedureTreeItem[]> {
        // Adapted from https://aka.ms/AA83fg8
        const storedProceduresQuery: string = `select n.nspname as schema,
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
                and p.prokind = 'p'
            order by name;`;

        const rows: IPostgresProceduresQueryRow[] = await getPostgresProcedureQueryRows(this, storedProceduresQuery);
        return rows.map(row => new PostgresStoredProcedureTreeItem(
            this,
            row,
            this.isDuplicateResource(row.name)
        ));
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        return contextValue === PostgresStoredProcedureTreeItem.contextValue;
    }
}
