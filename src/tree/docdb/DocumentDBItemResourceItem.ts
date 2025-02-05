/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type JSONValue, type RequestOptions } from '@azure/cosmos';
import { createContextValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { DocumentDBHiddenFields } from '../../constants';
import { type EditableTreeItem } from '../../DatabasesFileSystem';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { extractPartitionKey, getDocumentId } from '../../utils/document';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type DocumentDBItemModel } from './models/DocumentDBItemModel';

export abstract class DocumentDBItemResourceItem
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue, EditableTreeItem
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.document';

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    protected constructor(
        public readonly model: DocumentDBItemModel,
        public readonly experience: Experience,
    ) {
        const uniqueId = this.generateUniqueId(this.model);
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}/documents/${uniqueId}`;
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
            },
        };
    }

    public get filePath(): string {
        return getDocumentTreeItemLabel(this.model.item) + '-cosmos-document.json';
    }

    public getFileContent(): Promise<string> {
        const clonedDoc: ItemDefinition = { ...this.model.item };

        // TODO: Why user can't change/see them?
        for (const field of DocumentDBHiddenFields) {
            delete clonedDoc[field];
        }

        return Promise.resolve(JSON.stringify(clonedDoc, null, 2));
    }

    public async writeFileContent(_context: IActionContext, content: string): Promise<void> {
        const newData: JSONValue = JSON.parse(content) as JSONValue;

        if (typeof newData !== 'object' || newData === null) {
            throw new Error('The document content is not a valid JSON object');
        }

        if (!newData['id'] || typeof newData['id'] !== 'string') {
            throw new Error('The "id" field is required to update a document');
        }

        // TODO: Does it matter to keep the same fields in the document? Why user can't change them?
        for (const field of DocumentDBHiddenFields) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            newData[field] = this.model.item[field];
        }

        // TODO: Does it make sense now? This check was created 4 years ago
        if (!newData['_etag'] || typeof newData['_etag'] !== 'string') {
            throw new Error(`The "_etag" field is required to update a document`);
        }

        const { endpoint, credentials, isEmulator } = this.model.accountInfo;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
        const options: RequestOptions = { accessCondition: { type: 'IfMatch', condition: newData['_etag'] } };
        const partitionKeyValues = this.model.container.partitionKey
            ? extractPartitionKey(this.model.item, this.model.container.partitionKey)
            : undefined;
        const response = await cosmosClient
            .database(this.model.database.id)
            .container(this.model.container.id)
            .item(newData['id'], partitionKeyValues)
            .replace(newData, options);

        if (response.resource) {
            this.model.item = response.resource;
        } else {
            throw new Error('Failed to update the document');
        }
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
