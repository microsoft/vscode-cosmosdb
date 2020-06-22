/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from 'pg';
import { TreeItemIconPath } from "vscode-azureextensionui";
import { getThemedIconPath } from "../../constants";
import { getPostgresProcedureQueryRows, IPostgresProceduresQueryRow } from '../getPostgresProcedureQueryRows';
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
        const rows: IPostgresProceduresQueryRow[] = await getPostgresProcedureQueryRows(this);
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
