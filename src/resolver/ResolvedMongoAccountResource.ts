/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppResource, ResolvedAppResourceBase } from "@microsoft/vscode-azext-utils/hostapi";
import { IMongoTreeRoot } from "../mongo/tree/IMongoTreeRoot";
import { MongoAccountTreeItem } from "../mongo/tree/MongoAccountTreeItem";
import { ResolvedDatabaseAccountResource } from "./ResolvedDatabaseAccountResource";

export class ResolvedMongoAccountResource extends ResolvedDatabaseAccountResource implements ResolvedAppResourceBase {
    root: IMongoTreeRoot;

    public constructor(ti: MongoAccountTreeItem, resource: AppResource) {
        super(ti, resource);

        this.connectionString = ti.connectionString;
        this.root = ti.root;
    }
}
