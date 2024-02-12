/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";
import { TreeElementBase, TreeElementWithId } from "@microsoft/vscode-azext-utils";

export interface DocDBConnection {
    type: "key",
    endpoint: string;
    key: string;
    isEmulator: boolean | undefined;
    getCosmosClient(): CosmosClient;
};

export interface DocDBElement extends TreeElementBase {
    connection: DocDBConnection;
}

export interface DocDBElementWithId extends TreeElementWithId {
    connection: DocDBConnection;
}
