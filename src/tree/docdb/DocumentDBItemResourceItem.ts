/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuid } from 'uuid';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { extractPartitionKey, getDocumentId } from '../../utils/document';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type DocumentDBItemModel } from './models/DocumentDBItemModel';

export abstract class DocumentDBItemResourceItem implements CosmosDBTreeElement {
    public id: string;
    public contextValue: string = 'cosmosDB.item.item';

    protected constructor(
        protected readonly model: DocumentDBItemModel,
        protected readonly experience: Experience,
    ) {
        // Generate a unique ID for the item
        // This is used to identify the item in the tree, not the item itself
        // The item id is not guaranteed to be unique
        this.id = uuid();
        this.contextValue = `${experience.api}.item.item`;
    }

    getTreeItem(): TreeItem {
        const documentId = getDocumentId(this.model.item, this.model.container.partitionKey);
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('file'),
            label: documentId?.id ?? documentId?._rid ?? '<empty id>',
            tooltip: new vscode.MarkdownString(
                `${this.generateDocumentTooltip()}\n${this.generatePartitionKeyTooltip()}`,
            ),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                title: 'Open Document',
                command: 'cosmosDB.openDocument',
            },
        };
    }

    protected generateDocumentTooltip(): string {
        return (
            '### Document\n' +
            '---\n' +
            `${this.model.item.id ? `- ID: **${this.model.item.id}**\n` : ''}` +
            `${this.model.item._id ? `- ID (_id): **${this.model.item._id}**\n` : ''}` +
            `${this.model.item._rid ? `- RID: **${this.model.item._rid}**\n` : ''}` +
            `${this.model.item._self ? `- Self Link: **${this.model.item._self}**\n` : ''}` +
            `${this.model.item._etag ? `- ETag: **${this.model.item._etag}**\n` : ''}` +
            `${this.model.item._ts ? `- Timestamp: **${this.model.item._ts}**\n` : ''}`
        );
    }

    protected generatePartitionKeyTooltip(): string {
        if (!this.model.container.partitionKey || this.model.container.partitionKey.paths.length === 0) {
            return '';
        }
        const partitionKeyPaths = this.model.container.partitionKey.paths.join(', ');
        let partitionKeyValues = extractPartitionKey(this.model.item, this.model.container.partitionKey);
        partitionKeyValues = Array.isArray(partitionKeyValues) ? partitionKeyValues : [partitionKeyValues];
        partitionKeyValues = partitionKeyValues.map((v) => {
            if (v === null) {
                return '\\<null>';
            }
            if (v === undefined) {
                return '\\<undefined>';
            }
            if (typeof v === 'object') {
                return JSON.stringify(v);
            }
            return v;
        });

        return (
            '### Partition Key\n' +
            '---\n' +
            `- Paths: **${partitionKeyPaths}**\n` +
            `- Values: **${partitionKeyValues.join(', ')}**\n`
        );
    }
}
