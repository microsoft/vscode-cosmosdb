/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig, QueryResult } from 'pg';
import { AzExtTreeItem, AzureParentTreeItem, IActionContext, ISubscriptionContext, TreeItemIconPath } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresFunctionTreeItem } from "./PostgresFunctionTreeItem";

export interface IPostgresFunctionsQueryRow {
    schema: string;
    name: string;
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
        const rows: IPostgresFunctionsQueryRow[] = await this.listFunctions();
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

    public async createChildImpl(context: IActionContext): Promise<PostgresFunctionTreeItem> {
        const schemas: string[] = await this.listSchemas();
        let schema: string;

        if (schemas.length === 1) {
            schema = schemas[0];
        } else {
            const schemaQuickPicks = schemas.map(s => { return { label: s }; });
            schema = (await ext.ui.showQuickPick(schemaQuickPicks, {
                placeHolder: localize('selectSchema', 'Select schema for new function...')
            })).label;
        }

        const cachedChildren: AzExtTreeItem[] = await this.getCachedChildren(context);
        const existingFunctionsInSchema: Set<string> = new Set();
        const existingFunctionsOutsideSchema: Set<string> = new Set();
        cachedChildren.map((child: PostgresFunctionTreeItem) => {
            if (child.schema === schema) {
                existingFunctionsInSchema.add(child.name);
            } else {
                existingFunctionsOutsideSchema.add(child.name);
            }
        });

        const name: string = (await ext.ui.showInputBox({
            prompt: localize('enterFunctionName', 'Enter function name'),
            validateInput: value => this.validateFunctionName(value, existingFunctionsInSchema)
        })).trim();

        const definition: string = defaultFunctionDefinition(schema, name);
        const isDuplicate: boolean = existingFunctionsOutsideSchema.has(name);
        return new PostgresFunctionTreeItem(this, { schema, name, definition }, isDuplicate);
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        return contextValue === PostgresFunctionTreeItem.contextValue;
    }

    private async listFunctions(functionName?: string): Promise<IPostgresFunctionsQueryRow[]> {
        const client = new Client(this.clientConfig);
        await client.connect();

        // Adapted from https://aka.ms/AA83fg8
        const functionsQuery: string = `select n.nspname as schema,
            p.proname as name,
            case when l.lanname = 'internal' then p.prosrc
                else pg_get_functiondef(p.oid)
                end as definition
            from pg_proc p
            left join pg_namespace n on p.pronamespace = n.oid
            left join pg_language l on p.prolang = l.oid
            where n.nspname not in ('pg_catalog', 'information_schema')
                ${this.parent.parent.supportsStoredProcedures() ? "and p.prokind = 'f'" : '' /* Only select functions, not stored procedures */}
                ${functionName ? `and p.proname = '${functionName}'` : '' /* Only select functions that match the given name (if provided) */}
            order by name;`;

        const queryResult: QueryResult = await client.query(functionsQuery);
        return queryResult.rows || [];
    }

    private async listSchemas(): Promise<string[]> {
        const client = new Client(this.clientConfig);
        await client.connect();

        const schemaQuery: string = `select n.nspname as schema
            from pg_namespace as n
            where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')`;

        const queryResult: QueryResult = await client.query(schemaQuery);
        return queryResult.rows ? queryResult.rows.map(row => row.schema) : [];
    }

    private validateFunctionName(name: string, existingFunctions: Set<string>): string | undefined {
        if (existingFunctions.has(name)) {
            return localize('functionAlreadyExists', 'A function named "{0}" already exists.', name);
        }

        return this.parent.parent.validateIdentifier(name, 'Name');
    }
}

const defaultFunctionDefinition = (schema: string, name: string) => `CREATE OR REPLACE FUNCTION ${schema}.${name}()
 RETURNS <return type>
 LANGUAGE plpgsql
AS $function$
	BEGIN
	END;
$function$
`;
