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

export async function getNoSqlQueryPlan(_context: IActionContext, args: { queryText: string } | undefined): Promise<void> {
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
