/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from "pg";
import { AzureParentTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { PostgresDatabaseTreeItem } from "./PostgresDatabaseTreeItem";

// Base class for Postgres tree items whose children are individual resources
export abstract class PostgresResourcesTreeItemBase extends AzureParentTreeItem<ISubscriptionContext> {
    public parent: PostgresDatabaseTreeItem;
    public clientConfig: ClientConfig;
    public resourcesAndSchemas: { [key: string]: string[] }; // Resource name to list of schemas

    public addResourcesAndSchemasEntry(name: string, schema: string): void {
        if (this.resourcesAndSchemas[name]) {
            this.resourcesAndSchemas[name].push(schema);
        } else {
            this.resourcesAndSchemas[name] = [schema];
        }
    }

    public isDuplicateResource(name: string): boolean {
        return this.resourcesAndSchemas[name].length > 1;
    }
}
