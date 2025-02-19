/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type JSONValue, type RequestOptions } from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Experience } from '../../AzureDBExperiences';
import { DocumentDBHiddenFields } from '../../constants';
import { type EditableFileSystemItem } from '../../DatabasesFileSystem';
import { type DocumentDBItemModel } from '../../tree/docdb/models/DocumentDBItemModel';
import { extractPartitionKey } from '../../utils/document';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { getCosmosClient } from '../getCosmosClient';

export class DocumentFileDescriptor implements EditableFileSystemItem {
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    constructor(
        public readonly id: string,
        public readonly model: DocumentDBItemModel,
        public readonly experience: Experience,
    ) {}

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
}
