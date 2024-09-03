/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type Container,
    type CosmosClient,
    type FeedOptions,
    type ItemDefinition,
    type ItemResponse,
    type QueryIterator,
} from '@azure/cosmos';
import {
    type IActionContext,
    type ICreateChildImplContext,
    type TreeItemIconPath,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { nonNullProp } from '../../utils/nonNull';
import { type DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBDocumentTreeItem } from './DocDBDocumentTreeItem';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

/**
 * This class provides logic for DocumentDB collections
 */
export class DocDBDocumentsTreeItem extends DocDBTreeItemBase<ItemDefinition> {
    public static contextValue: string = 'cosmosDBDocumentsGroup';
    public readonly contextValue: string = DocDBDocumentsTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Documents';
    public readonly parent: DocDBCollectionTreeItem;
    public suppressMaskLabel = true;

    constructor(parent: DocDBCollectionTreeItem) {
        super(parent);
        this.parent = parent;
        this.root = this.parent.root;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('files');
    }

    public get id(): string {
        return '$Documents';
    }

    public get label(): string {
        return 'Documents';
    }

    public get link(): string {
        return this.parent.link;
    }

    public getIterator(client: CosmosClient, feedOptions: FeedOptions): QueryIterator<ItemDefinition> {
        return this.getContainerClient(client).items.readAll(feedOptions);
    }

    public initChild(document: ItemDefinition): DocDBDocumentTreeItem {
        return new DocDBDocumentTreeItem(this, document);
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<DocDBDocumentTreeItem> {
        let docID = await context.ui.showInputBox({
            prompt: 'Enter a document ID or leave blank for a generated ID',
            stepName: 'createDocument',
        });

        docID = docID.trim();
        let body: ItemDefinition = { id: docID };
        body = await this.promptForPartitionKey(context, body);
        context.showCreatingTreeItem(docID);
        const item: ItemDefinition = await this.createDocument(body);

        return this.initChild(item);
    }

    public async createDocument(body: ItemDefinition): Promise<ItemDefinition> {
        const item: ItemResponse<ItemDefinition> = await this.getContainerClient(
            this.root.getCosmosClient(),
        ).items.create(body);
        return nonNullProp(item, 'resource');
    }

    // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    public documentHasPartitionKey(doc: Object): boolean {
        let interim = doc;
        let partitionKey: string | undefined = this.parent.partitionKey && this.parent.partitionKey.paths[0];
        if (!partitionKey) {
            return true;
        }
        if (partitionKey[0] === '/') {
            partitionKey = partitionKey.slice(1);
        }
        const partitionKeyPath = partitionKey.split('/');

        for (const prop of partitionKeyPath) {
            // eslint-disable-next-line no-prototype-builtins
            if (interim.hasOwnProperty(prop)) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                interim = interim[prop];
            } else {
                return false;
            }
        }
        return true;
    }

    public async promptForPartitionKey(context: IActionContext, body: ItemDefinition): Promise<ItemDefinition> {
        const partitionKey: string | undefined = this.parent.partitionKey && this.parent.partitionKey.paths[0];
        if (partitionKey) {
            const partitionKeyValue: string = await context.ui.showInputBox({
                prompt: `Enter a value for the partition key ("${partitionKey}")`,
                stepName: 'valueforParititionKey',
            });
            // Unlike delete/replace, createDocument does not accept a partition key value via an options parameter.
            // We need to present the partitionKey value as part of the document contents
            Object.assign(body, this.createPartitionPathObject(partitionKey, partitionKeyValue));
        }
        return body;
    }

    public getContainerClient(client: CosmosClient): Container {
        return this.parent.getContainerClient(client);
    }

    // Create a nested Object given the partition key path and value
    // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    private createPartitionPathObject(partitionKey: string, partitionKeyValue: string): Object {
        //remove leading slash
        if (partitionKey[0] === '/') {
            partitionKey = partitionKey.slice(1);
        }
        const keyPath = partitionKey.split('/');
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
        const PartitionPath: Object = {};
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
        let interim: Object = PartitionPath;
        let i: number;
        for (i = 0; i < keyPath.length - 1; i++) {
            interim[keyPath[i]] = {};
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            interim = interim[keyPath[i]];
        }
        interim[keyPath[i]] = partitionKeyValue;
        return PartitionPath;
    }
}
