/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, Item, ItemDefinition, RequestOptions } from '@azure/cosmos';
import { AzExtTreeItem, DialogResponses, IActionContext, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { IEditableTreeItem } from '../../DatabasesFileSystem';
import { ext } from '../../extensionVariables';
import { nonNullProp } from '../../utils/nonNull';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { DocDBDocumentsTreeItem } from './DocDBDocumentsTreeItem';
import { sanitizeId } from './DocDBUtils';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

const hiddenFields: string[] = ['_rid', '_self', '_etag', '_attachments', '_ts'];

/**
 * Represents a Cosmos DB DocumentDB (SQL) document
 */
export class DocDBDocumentTreeItem extends AzExtTreeItem implements IEditableTreeItem {
    public static contextValue: string = "cosmosDBDocument";
    public readonly contextValue: string = DocDBDocumentTreeItem.contextValue;
    public readonly parent: DocDBDocumentsTreeItem;
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();
    private _label: string;
    private _document: ItemDefinition;

    constructor(parent: DocDBDocumentsTreeItem, document: ItemDefinition) {
        super(parent);
        this._document = document;
        this._label = getDocumentTreeItemLabel(this._document);
        ext.fileSystem.fireChangedEvent(this);
        this.commandId = 'cosmosDB.openDocument';
    }

    public get root(): IDocDBTreeRoot {
        return this.parent.root;
    }

    public get id(): string {
        return sanitizeId(`${this.document.id}:${this.getPartitionKeyValue()}`);
    }

    public get filePath(): string {
        return this.label + '-cosmos-document.json';
    }

    public async refreshImpl(): Promise<void> {
        this._label = getDocumentTreeItemLabel(this._document);
        ext.fileSystem.fireChangedEvent(this);
    }

    public get link(): string {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return this.document._self;
    }

    get document(): ItemDefinition {
        return this._document;
    }

    get label(): string {
        return this._label;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('file');
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const message: string = `Are you sure you want to delete document '${this.label}'?`;
        await context.ui.showWarningMessage(message, { modal: true, stepName: 'deleteDocument' }, DialogResponses.deleteResponse);
        const client = this.root.getCosmosClient();
        await this.getDocumentClient(client).delete();
    }

    public async getFileContent(): Promise<string> {
        const clonedDoc: {} = { ...this.document };
        for (const field of hiddenFields) {
            delete clonedDoc[field];
        }
        return JSON.stringify(clonedDoc, null, 2);
    }

    public async writeFileContent(_context: IActionContext, content: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const newData = JSON.parse(content);
        for (const field of hiddenFields) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            newData[field] = this.document[field];
        }

        const client: CosmosClient = this.root.getCosmosClient();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (["_etag"].some((element) => !newData[element])) {
            throw new Error(`The "_self" and "_etag" fields are required to update a document`);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            const options: RequestOptions = { accessCondition: { type: 'IfMatch', condition: newData._etag } };
            const response = await this.getDocumentClient(client).replace(newData, options);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            this._document = response.resource;
        }
    }

    private getPartitionKeyValue(): string | number | undefined {
        const partitionKey = this.parent.parent.partitionKey;
        if (!partitionKey) { //Fixed collections -> no partitionKeyValue
            return undefined;
        }
        const fields = partitionKey.paths[0].split('/');
        if (fields[0] === '') {
            fields.shift();
        }
        let value: any;
        for (const field of fields) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            value = value ? value[field] : this.document[field];
            if (!value) { //Partition Key exists, but this document doesn't have a value
                return '';
            }
        }

        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "undefined") {
            throw new Error("Invalid data type for partition key");
        }
        return value;
    }

    private getDocumentClient(client: CosmosClient): Item {
        return this.parent.getContainerClient(client).item(nonNullProp(this.document, 'id'), this.getPartitionKeyValue());
    }
}
