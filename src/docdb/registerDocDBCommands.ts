/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, ITreeItemPickerContext, registerCommand } from "@microsoft/vscode-azext-utils";
import { commands } from "vscode";
import { doubleClickDebounceDelay } from "../constants";
import { ext } from "../extensionVariables";
import { AttachedAccountSuffix } from "../tree/AttachedAccountsTreeItem";
import { DocDBAccountTreeItem } from "./tree/DocDBAccountTreeItem";
import { DocDBCollectionTreeItem } from "./tree/DocDBCollectionTreeItem";
import { DocDBDatabaseTreeItem } from "./tree/DocDBDatabaseTreeItem";
import { DocDBDocumentsTreeItem } from "./tree/DocDBDocumentsTreeItem";
import { DocDBDocumentTreeItem } from "./tree/DocDBDocumentTreeItem";
import { DocDBStoredProceduresTreeItem } from "./tree/DocDBStoredProceduresTreeItem";
import { DocDBStoredProcedureTreeItem } from "./tree/DocDBStoredProcedureTreeItem";

export function registerDocDBCommands(): void {
    registerCommand('cosmosDB.createDocDBDatabase', createDocDBDatabase);
    registerCommand('cosmosDB.createDocDBCollection', createDocDBCollection);
    registerCommand('cosmosDB.createDocDBDocument', async (context: IActionContext, node?: DocDBDocumentsTreeItem) => {
        if (!node) {
            node = <DocDBDocumentsTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(DocDBDocumentsTreeItem.contextValue, context);
        }
        const documentNode = <DocDBDocumentTreeItem>await node.createChild(context);
        await commands.executeCommand("cosmosDB.openDocument", documentNode);

    });
    registerCommand('cosmosDB.createDocDBStoredProcedure', async (context: IActionContext, node?: DocDBStoredProceduresTreeItem) => {
        if (!node) {
            node = <DocDBStoredProceduresTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(DocDBStoredProceduresTreeItem.contextValue, context);
        }
        const childNode = await node.createChild(context);
        await commands.executeCommand("cosmosDB.openStoredProcedure", childNode);

    });
    registerCommand('cosmosDB.deleteDocDBDatabase', deleteDocDBDatabase);
    registerCommand('cosmosDB.deleteDocDBCollection', deleteDocDBCollection);
    registerCommand('cosmosDB.openStoredProcedure', async (context: IActionContext, node?: DocDBStoredProcedureTreeItem) => {
        if (!node) {
            node = <DocDBStoredProcedureTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker([DocDBStoredProcedureTreeItem.contextValue], context);
        }
        await ext.getFileSystem(node).showTextDocument(node);
    }, doubleClickDebounceDelay);
    registerCommand('cosmosDB.deleteDocDBDocument', async (context: IActionContext, node?: DocDBDocumentTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = <DocDBDocumentTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(DocDBDocumentTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.deleteDocDBStoredProcedure', async (context: IActionContext, node?: DocDBStoredProcedureTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = <DocDBStoredProcedureTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(DocDBStoredProcedureTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
}

export async function createDocDBDatabase(context: IActionContext, node?: DocDBAccountTreeItem): Promise<void> {
    if (!node) {
        node = <DocDBAccountTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker([DocDBAccountTreeItem.contextValue, DocDBAccountTreeItem.contextValue + AttachedAccountSuffix], context);
    }
    const databaseNode: DocDBDatabaseTreeItem = <DocDBDatabaseTreeItem>await node.createChild(context);
    await databaseNode.createChild(context);
}

export async function createDocDBCollection(context: IActionContext, node?: DocDBDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = <DocDBDatabaseTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(DocDBDatabaseTreeItem.contextValue, context);
    }
    await node.createChild(context);
}

export async function deleteDocDBDatabase(context: IActionContext, node?: DocDBDatabaseTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = <DocDBDatabaseTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(DocDBDatabaseTreeItem.contextValue, context);
    }
    await node.deleteTreeItem(context);
}

export async function deleteDocDBCollection(context: IActionContext, node?: DocDBCollectionTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = <DocDBCollectionTreeItem>await ext.rgApi.appResourceTree.showTreeItemPicker(DocDBCollectionTreeItem.contextValue, context);
    }
    await node.deleteTreeItem(context);
}
