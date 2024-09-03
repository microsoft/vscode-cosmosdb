/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type CosmosClient, type DatabaseDefinition, type FeedOptions, type QueryIterator, type Resource } from '@azure/cosmos';
import  { type AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import  { type AppResource, type ResolvedAppResourceBase } from '@microsoft/vscode-azext-utils/hostapi';
import  { type DocDBAccountTreeItemBase } from '../docdb/tree/DocDBAccountTreeItemBase';
import  { type IDocDBTreeRoot } from '../docdb/tree/IDocDBTreeRoot';
import { ResolvedDatabaseAccountResource } from './ResolvedDatabaseAccountResource';

export class ResolvedDocDBAccountResource extends ResolvedDatabaseAccountResource implements ResolvedAppResourceBase {
    public root: IDocDBTreeRoot;

    initChild: (resource: Resource) => AzExtTreeItem;
    isServerless?: boolean;
    getIterator?: (client: CosmosClient, feedOptions: FeedOptions) => QueryIterator<DatabaseDefinition & Resource>;

    public constructor(ti: DocDBAccountTreeItemBase, resource: AppResource) {
        super(ti, resource);

        this.connectionString = ti.connectionString;
        this.root = ti.root;

        this.isServerless = ti.isServerless;
        this.getIterator = ti.getIterator;
        this.initChild = ti.initChild;
    }
}
