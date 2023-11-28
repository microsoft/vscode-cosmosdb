/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, ITreeItemPickerContext, registerCommand, registerCommandWithTreeNodeUnwrapping } from "@microsoft/vscode-azext-utils";
import { commands, languages } from "vscode";
import { KeyValueStore } from "../KeyValueStore";
import { doubleClickDebounceDelay, sqlFilter } from "../constants";
import { ext } from "../extensionVariables";
import { NoSqlCodeLensProvider } from "./NoSqlCodeLensProvider";
import { writeNoSqlQuery } from "./WriteNoSqlQueryCommand";
import { getCosmosClient } from "./getCosmosClient";
import { DocDBAccountTreeItem } from "./tree/DocDBAccountTreeItem";
import { DocDBCollectionTreeItem } from "./tree/DocDBCollectionTreeItem";
import { DocDBDatabaseTreeItem } from "./tree/DocDBDatabaseTreeItem";
import { DocDBDocumentTreeItem } from "./tree/DocDBDocumentTreeItem";
import { DocDBDocumentsTreeItem } from "./tree/DocDBDocumentsTreeItem";
import { DocDBStoredProcedureTreeItem } from "./tree/DocDBStoredProcedureTreeItem";
import { DocDBStoredProceduresTreeItem } from "./tree/DocDBStoredProceduresTreeItem";

const nosqlLanguageId = "nosql";

export function registerDocDBCommands(): void {
    const nosqlCodeLensProvider = new NoSqlCodeLensProvider();
    ext.context.subscriptions.push(languages.registerCodeLensProvider(nosqlLanguageId, nosqlCodeLensProvider));

    registerCommand("cosmosDB.executeNoSqlQuery", executeNoSqlQuery);
    registerCommand("cosmosDB.getNoSqlQueryPlan", getNoSqlQueryPlan);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBDatabase', createDocDBDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.writeNoSqlQuery', writeNoSqlQuery);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBCollection', createDocDBCollection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBDocument', async (context: IActionContext, node?: DocDBDocumentsTreeItem) => {
        if (!node) {
            node = await pickDocDBAccount<DocDBDocumentsTreeItem>(context, DocDBDocumentsTreeItem.contextValue);
        }
        const documentNode = <DocDBDocumentTreeItem>await node.createChild(context);
        await commands.executeCommand("cosmosDB.openDocument", documentNode);

    });
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBStoredProcedure', async (context: IActionContext, node?: DocDBStoredProceduresTreeItem) => {
        if (!node) {
            node = await pickDocDBAccount<DocDBStoredProceduresTreeItem>(context, DocDBStoredProceduresTreeItem.contextValue);
        }
        const childNode = await node.createChild(context);
        await commands.executeCommand("cosmosDB.openStoredProcedure", childNode);

    });
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBDatabase', deleteDocDBDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBCollection', deleteDocDBCollection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openStoredProcedure', async (context: IActionContext, node?: DocDBStoredProcedureTreeItem) => {
        if (!node) {
            node = await pickDocDBAccount<DocDBStoredProcedureTreeItem>(context, DocDBStoredProcedureTreeItem.contextValue);
        }
        await ext.fileSystem.showTextDocument(node);
    }, doubleClickDebounceDelay);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBDocument', async (context: IActionContext, node?: DocDBDocumentTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = await pickDocDBAccount<DocDBDocumentTreeItem>(context, DocDBDocumentTreeItem.contextValue);
        }
        await node.deleteTreeItem(context);
    });
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBStoredProcedure', async (context: IActionContext, node?: DocDBStoredProcedureTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = await pickDocDBAccount<DocDBStoredProcedureTreeItem>(context, DocDBStoredProcedureTreeItem.contextValue);

        }
        await node.deleteTreeItem(context);
    });
}

async function executeNoSqlQuery(_context: IActionContext, args: { queryId: string, query: string } | undefined): Promise<void> {
    if (!args) {
        throw new Error("Unable to execute query due to missing args. Please navigate to the Cosmos DB collection node and start writing a query from its context menu.");
    }
    const { queryId, query } = args;
    const nodeData = KeyValueStore.instance.get(queryId);
    if (nodeData) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        const { databaseId, collectionId, endpoint, masterKey, isEmulator } = nodeData as any;
        const client = getCosmosClient(endpoint, masterKey, isEmulator);
        const response = await client.database(databaseId).container(collectionId).items.query(query).fetchAll();
        console.log("response", response);
        console.log("response.resources", response.resources);
    } else {
        throw new Error("Unable to execute query due to missing node data. Please navigate to the Cosmos DB collection node and start writing a query from its context menu.");
    }
}

async function getNoSqlQueryPlan(_context: IActionContext, args: { queryId: string, query: string } | undefined): Promise<void> {
    if (!args) {
        throw new Error("Unable to get query plan due to missing args. Please navigate to the Cosmos DB collection node and start writing a query from its context menu.");
    }
    const { queryId, query } = args;
    const nodeData = KeyValueStore.instance.get(queryId);
    if (nodeData) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
        const { databaseId, collectionId, endpoint, masterKey, isEmulator } = nodeData as any;
        const client = getCosmosClient(endpoint, masterKey, isEmulator);
        const response = await client.database(databaseId).container(collectionId).getQueryPlan(query);
        console.log("response", response);
        console.log("result.result", response.result);
    } else {
        throw new Error("Unable to get query plan due to missing node data. Please navigate to the Cosmos DB collection node and start writing a query from its context menu.");
    }
}

export async function createDocDBDatabase(context: IActionContext, node?: DocDBAccountTreeItem): Promise<void> {
    if (!node) {
        node = await pickDocDBAccount<DocDBAccountTreeItem>(context);
    }
    const databaseNode: DocDBDatabaseTreeItem = <DocDBDatabaseTreeItem>await node.createChild(context);
    await databaseNode.createChild(context);
}

export async function createDocDBCollection(context: IActionContext, node?: DocDBDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = await pickDocDBAccount<DocDBDatabaseTreeItem>(context, DocDBDatabaseTreeItem.contextValue);
    }
    await node.createChild(context);
}

export async function deleteDocDBDatabase(context: IActionContext, node?: DocDBDatabaseTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBDatabaseTreeItem>(context, DocDBDatabaseTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
}

export async function deleteDocDBCollection(context: IActionContext, node?: DocDBCollectionTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickDocDBAccount<DocDBCollectionTreeItem>(context, DocDBCollectionTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
}

async function pickDocDBAccount<T extends AzExtTreeItem>(context: IActionContext, expectedContextValue?: string | RegExp | (string | RegExp)[]): Promise<T> {
    return await ext.rgApi.pickAppResource<T>(context, {
        filter: [
            sqlFilter
        ],
        expectedChildContextValue: expectedContextValue
    });
}
