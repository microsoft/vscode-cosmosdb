/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { extractPartitionKey, getDocumentId } from '../../utils/document';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type DocumentDBItemModel } from './models/DocumentDBItemModel';

/**
 * Sanitize the id of a DocDB tree item so it can be safely used in a query string.
 * Learn more at: https://github.com/ljharb/qs#rfc-3986-and-rfc-1738-space-encoding
 */
export function sanitizeId(id: string): string {
    return id.replace(/\+/g, ' ');
}

export abstract class DocumentDBItemResourceItem
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.document';

    protected constructor(
        public readonly model: DocumentDBItemModel,
        public readonly experience: Experience,
    ) {
        const uniqueId = this.generateUniqueId(this.model);
        this.id = sanitizeId(
            `${model.accountInfo.id}/${model.database.id}/${model.container.id}/documents/${uniqueId}`,
        );
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('file'),
            label: getDocumentTreeItemLabel(this.model.item),
            tooltip: new vscode.MarkdownString(
                `${this.generateDocumentTooltip()}\n${this.generatePartitionKeyTooltip()}`,
            ),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                title: 'Open Document',
                command: 'cosmosDB.openDocument',
                arguments: [this],
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
        const partitionKeyValues = this.generatePartitionKeyValue(this.model);

        return (
            '### Partition Key\n' +
            '---\n' +
            `- Paths: **${partitionKeyPaths}**\n` +
            `- Values: **${partitionKeyValues}**\n`
        );
    }

    /**
     * Warning: This method is used to generate a unique ID for the document tree item.
     * It is not used to generate the actual document ID.
     */
    protected generateUniqueId(model: DocumentDBItemModel): string {
        const documentId = getDocumentId(model.item, model.container.partitionKey);
        const id = documentId?.id;
        const rid = documentId?._rid;
        const partitionKeyValues = this.generatePartitionKeyValue(model);

        return `${id || '<empty id>'}|${partitionKeyValues || '<empty partition key>'}|${rid || '<empty rid>'}`;
    }

    /**
     * Warning: This method is used to generate a partition key value for the document tree item.
     * It is not used to generate the actual partition key value.
     */
    protected generatePartitionKeyValue(model: DocumentDBItemModel): string {
        if (!model.container.partitionKey || model.container.partitionKey.paths.length === 0) {
            return '';
        }

        let partitionKeyValues = extractPartitionKey(model.item, model.container.partitionKey);
        partitionKeyValues = Array.isArray(partitionKeyValues) ? partitionKeyValues : [partitionKeyValues];
        partitionKeyValues = partitionKeyValues
            .map((v) => {
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
            })
            .join(', ');

        return partitionKeyValues;
    }
}
