/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, FeedOptions, ItemDefinition, ItemResponse, PartitionKeyDefinition, QueryIterator, Resource } from '@azure/cosmos';
import * as vscode from 'vscode';
import { ICreateChildImplContext, UserCancelledError } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { nonNullProp } from '../../utils/nonNull';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBDocumentTreeItem } from './DocDBDocumentTreeItem';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

/**
 * This class provides logic for DocumentDB collections
 */
export class DocDBDocumentsTreeItem extends DocDBTreeItemBase<ItemDefinition> {
    public static contextValue: string = "cosmosDBDocumentsGroup";
    public readonly contextValue: string = DocDBDocumentsTreeItem.contextValue;
    public readonly childTypeLabel: string = "Documents";
    public readonly parent: DocDBCollectionTreeItem;

    constructor(parent: DocDBCollectionTreeItem) {
        super(parent);
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Collection.svg');
    }

    public get id(): string {
        return "$Documents";
    }

    public get label(): string {
        return "Documents";
    }

    public get link(): string {
        return this.parent.link;
    }

    public async getIterator(client: CosmosClient, feedOptions: FeedOptions): Promise<QueryIterator<ItemDefinition>> {
        return client.database(this.parent.parent.id).container(this.parent.id).items.readAll(feedOptions);
    }

    public initChild(document: ItemDefinition & Resource): DocDBDocumentTreeItem {
        return new DocDBDocumentTreeItem(this, document);
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<DocDBDocumentTreeItem> {
        let docID = await vscode.window.showInputBox({
            prompt: "Enter a document ID or leave blank for a generated ID",
            ignoreFocusOut: true
        });

        if (docID || docID === "") {
            docID = docID.trim();
            let body: ItemDefinition = { id: docID };
            body = (await this.promptForPartitionKey(body));
            context.showCreatingTreeItem(docID);
            const item: ItemResponse<ItemDefinition> = await this.root.getDocumentClient().database(this.parent.parent.id).container(this.parent.id).items.create(body);

            return this.initChild(nonNullProp(item, 'resource'));
        }

        throw new UserCancelledError();
    }

    public async createDocument(body: ItemDefinition): Promise<ItemDefinition & Resource> {
        const item: ItemResponse<ItemDefinition> = await this.root.getDocumentClient().database(this.parent.id).container(this.id).items.create(body);
        return nonNullProp(item, 'resource');
    }

    public documentHasPartitionKey(doc: Object): boolean {
        let interim = doc;
        const partitionKey = this.parent.partitionKey && this.parent.partitionKey;
        if (!partitionKey?.paths) {
            return true;
        }
        let partitionKeyPath: string = partitionKey.paths[0];
        if (partitionKeyPath[0] === '/') {
            partitionKeyPath = partitionKeyPath.slice(1);
        }
        const keyPath = partitionKeyPath.split('/');
        let i: number;
        for (i = 0; i < keyPath.length - 1; i++) {
            if (interim.hasOwnProperty(keyPath[i])) {
                interim = interim[keyPath[i]];
            } else {
                return false;
            }
        }
        return true;
    }

    public async promptForPartitionKey(body: ItemDefinition): Promise<ItemDefinition> {
        const partitionKey: PartitionKeyDefinition | undefined = this.parent.partitionKey && this.parent.partitionKey;
        if (partitionKey?.paths) {
            const partitionKeyValue: string = await ext.ui.showInputBox({
                prompt: `Enter a value for the partition key ("${partitionKey}")`
            });
            // Unlike delete/replace, createDocument does not accept a partition key value via an options parameter.
            // We need to present the partitionKey value as part of the document contents
            Object.assign(body, this.createPartitionPathObject(partitionKey, partitionKeyValue));
        }
        return body;
    }

    // Create a nested Object given the partition key path and value
    private createPartitionPathObject(partitionKey: PartitionKeyDefinition, partitionKeyValue: string): Object {
        //remove leading slash
        let partitionKeyPath = partitionKey?.paths[0];
        if (partitionKeyPath === '/') {
            partitionKeyPath = partitionKeyPath.slice(1);
        }
        const keyPath = partitionKeyPath.split('/');
        const PartitionPath: Object = {};
        let interim: Object = PartitionPath;
        let i: number;
        for (i = 0; i < keyPath.length - 1; i++) {
            interim[keyPath[i]] = {};
            interim = interim[keyPath[i]];
        }
        interim[keyPath[i]] = partitionKeyValue;
        return PartitionPath;
    }
}
