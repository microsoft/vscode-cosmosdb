/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from "@microsoft/vscode-azext-utils";
import { ViewColumn } from "vscode";
import { KeyValueStore } from "../../KeyValueStore";
import * as vscodeUtil from "../../utils/vscodeUtils";
import { NoSqlQueryConnection, noSqlQueryConnectionKey } from "../NoSqlCodeLensProvider";
import { getCosmosClient } from "../getCosmosClient";

export async function executeNoSqlQuery(_context: IActionContext, args: { queryText: string, populateQueryMetrics?: boolean }): Promise<void> {
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
