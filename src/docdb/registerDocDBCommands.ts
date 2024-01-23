/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, IActionContext, ITreeItemPickerContext, registerCommand, registerCommandWithTreeNodeUnwrapping } from "@microsoft/vscode-azext-utils";
import { ViewColumn, commands, languages } from "vscode";
import { KeyValueStore } from "../KeyValueStore";
import { doubleClickDebounceDelay, sqlFilter } from "../constants";
import { ext } from "../extensionVariables";
import { localize } from "../utils/localize";
import * as vscodeUtil from "../utils/vscodeUtils";
import { NoSqlCodeLensProvider, NoSqlQueryConnection, noSqlQueryConnectionKey } from "./NoSqlCodeLensProvider";
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
    ext.noSqlCodeLensProvider = new NoSqlCodeLensProvider();
    ext.context.subscriptions.push(languages.registerCodeLensProvider(nosqlLanguageId, ext.noSqlCodeLensProvider));

    registerCommand("cosmosDB.connectNoSqlContainer", connectNoSqlContainer);
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
    registerCommandWithTreeNodeUnwrapping('cosmosDB.executeDocDBStoredProcedure', async (context: IActionContext, node?: DocDBStoredProcedureTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = await pickDocDBAccount<DocDBStoredProcedureTreeItem>(context, DocDBStoredProcedureTreeItem.contextValue);
        }

        const partitionKey = await context.ui.showInputBox({
            title: 'Partition Key',
            // @todo: add a learnMoreLink
        });

        const paramString = await context.ui.showInputBox({
            title: 'Parameters',
            placeHolder: localize("executeCosmosStoredProcedureParameters", "empty or array of values e.g. [1, {key: value}]"),
            // @todo: add a learnMoreLink
        });

        let parameters: (string | number | object)[] | undefined = undefined;
        if (paramString !== "") {
            try {
                parameters = JSON.parse(paramString) as (string | number | object)[];
            } catch (error) {
                // Ignore parameters if they are invalid
            }
        }

        await node.execute(context, partitionKey, parameters);
    });
}

function setConnectedNoSqlContainer(node: DocDBCollectionTreeItem): void {
    const noSqlQueryConnection: NoSqlQueryConnection = {
        databaseId: node.parent.id,
        containerId: node.id,
        endpoint: node.root.endpoint,
        masterKey: node.root.masterKey,
        isEmulator: !!node.root.isEmulator
    };
    KeyValueStore.instance.set(noSqlQueryConnectionKey, noSqlQueryConnection);
    ext.noSqlCodeLensProvider.updateCodeLens();
}

async function writeNoSqlQuery(_context: IActionContext, node: DocDBCollectionTreeItem): Promise<void> {
    setConnectedNoSqlContainer(node);
    const sampleQuery = `SELECT * FROM ${node.id}`;
    await vscodeUtil.showNewFile(sampleQuery, `query for ${node.label}`, ".nosql");
}

async function connectNoSqlContainer(context: IActionContext): Promise<void> {
    const node = await pickDocDBAccount<DocDBCollectionTreeItem>(context, DocDBCollectionTreeItem.contextValue);
    setConnectedNoSqlContainer(node);
}

async function executeNoSqlQuery(_context: IActionContext, args: { queryText: string, populateQueryMetrics?: boolean }): Promise<void> {
    if (!args) {
        throw new Error("Unable to execute query due to missing args. Please connect to a Cosmos DB collection.");
    }
    const { queryText, populateQueryMetrics } = args;
    const connectedCollection = KeyValueStore.instance.get(noSqlQueryConnectionKey);
    if (!connectedCollection) {
        throw new Error("Unable to execute query due to missing node data. Please connect to a Cosmos DB collection node.");
    } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { databaseId, containerId, endpoint, masterKey, isEmulator } = connectedCollection as NoSqlQueryConnection;
        const client = getCosmosClient(endpoint, masterKey, isEmulator);
        const options = { populateQueryMetrics };
        const response = await client.database(databaseId).container(containerId).items.query(queryText, options).fetchAll();
        const resultDocumentTitle = `query results for ${containerId}`;
        if (populateQueryMetrics === true) {
            await vscodeUtil.showNewFile(JSON.stringify({
                result: response.resources,
                queryMetrics: response.queryMetrics
            }, undefined, 2), resultDocumentTitle, ".json", ViewColumn.Beside);
        } else {
            await vscodeUtil.showNewFile(JSON.stringify(response.resources, undefined, 2), resultDocumentTitle, ".json", ViewColumn.Beside);
        }
    }
}

async function getNoSqlQueryPlan(_context: IActionContext, args: { queryText: string } | undefined): Promise<void> {
    if (!args) {
        throw new Error("Unable to get query plan due to missing args. Please connect to a Cosmos DB collection node.");
    }
    const queryText = args.queryText;
    const connectedCollection = KeyValueStore.instance.get(noSqlQueryConnectionKey);
    if (!connectedCollection) {
        throw new Error("Unable to get query plan due to missing node data. Please connect to a Cosmos DB collection.");
    } else {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const { databaseId, containerId, endpoint, masterKey, isEmulator } = connectedCollection as NoSqlQueryConnection;
        const client = getCosmosClient(endpoint, masterKey, isEmulator);
        const response = await client.database(databaseId).container(containerId).getQueryPlan(queryText);
        await vscodeUtil.showNewFile(JSON.stringify(response.result, undefined, 2), `query results for ${containerId}`, ".json", ViewColumn.Beside);
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
