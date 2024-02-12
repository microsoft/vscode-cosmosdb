/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccountGetResults } from "@azure/arm-cosmosdb";
import { TreeElementBase, TreeElementWithId } from "@microsoft/vscode-azext-utils";
import { AzExtResourceType, type AzureResource, type AzureResourceBranchDataProvider } from "@microsoft/vscode-azureresources-api";
import * as vscode from "vscode";
import { sqlDefaultExperienceTag } from "../constants";
import { ext } from "../extensionVariables";
import { DocDBAccountItem } from "./Cosmos/DocDBAccountItem";

export class CosmosDBBranchDataProvider extends vscode.Disposable implements AzureResourceBranchDataProvider<TreeElementBase> {
    private readonly onDidChangeTreeDataEmitter: vscode.EventEmitter<TreeElementBase | undefined> = new vscode.EventEmitter<TreeElementBase | undefined>();

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
    }

    get onDidChangeTreeData(): vscode.Event<TreeElementBase | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    async getChildren(element: TreeElementBase): Promise<TreeElementWithId[] | null | undefined> {
        const children = await element.getChildren?.();
        if (!!children) {
            return children.filter((child): child is TreeElementWithId => child.id !== undefined).map((child) => {
                return ext.state.wrapItemInStateHandling(child, () => this.refresh(child));
            });
        }
        return;
    }

    async getResourceItem(element: AzureResource & DatabaseAccountGetResults): Promise<TreeElementBase> {
        let resourceItem: TreeElementWithId | undefined;
        if (element.resourceType === AzExtResourceType.AzureCosmosDb && element.tags?.defaultExperience === sqlDefaultExperienceTag) {
            resourceItem = new DocDBAccountItem(element);
        } else {
            // @todo: Implement for other resource types
            resourceItem = {
                id: element.id,
                getTreeItem: () => {
                    return {
                        label: element.name,
                        id: element.id,
                        iconPath: new vscode.ThemeIcon("database"),
                        contextValue: "test"
                    }
                }
            };
        }

        if (!resourceItem) {
            throw Error("Failed to get resource item");
        } else {
            return ext.state.wrapItemInStateHandling(resourceItem, () => this.refresh(resourceItem));
        }
    }

    async getTreeItem(element: TreeElementBase): Promise<vscode.TreeItem> {
        return await element.getTreeItem();
    }

    refresh(element?: TreeElementBase): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
