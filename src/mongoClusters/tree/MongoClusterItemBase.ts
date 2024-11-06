/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElementBase } from "@microsoft/vscode-azext-utils";
import { type AzureSubscription } from "@microsoft/vscode-azureresources-api";
import { type MongoClusterModel } from "./MongoClusterModel";

// This info will be available at every level in the tree for immediate access
export interface MongoClusterItemBase extends TreeElementBase {
    subscription: AzureSubscription;
    mongoCluster: MongoClusterModel;
}
