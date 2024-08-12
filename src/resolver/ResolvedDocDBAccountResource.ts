/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, DatabaseDefinition, FeedOptions, QueryIterator, Resource } from '@azure/cosmos';
import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { AppResource, ResolvedAppResourceBase } from '@microsoft/vscode-azext-utils/hostapi';
import { DocDBAccountTreeItemBase } from '../docdb/tree/DocDBAccountTreeItemBase';
import { IDocDBTreeRoot } from '../docdb/tree/IDocDBTreeRoot';
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
