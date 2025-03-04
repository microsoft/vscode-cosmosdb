/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Experience } from '../../AzureDBExperiences';
import { type DocumentDBStoredProcedureModel } from '../../tree/docdb/models/DocumentDBStoredProcedureModel';
import { nonNullProp } from '../../utils/nonNull';
import { getCosmosClient } from '../getCosmosClient';
import { type EditableFileSystemItem } from './CosmosFileSystem';

export class StoredProcedureFileDescriptor implements EditableFileSystemItem {
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();
    public isReadOnly: boolean = false;

    constructor(
        public readonly id: string,
        public readonly model: DocumentDBStoredProcedureModel,
        public readonly experience: Experience,
    ) {}

    public get filePath(): string {
        return this.model.procedure.id + '-cosmos-stored-procedure.js';
    }

    public read(): Promise<string> {
        return Promise.resolve(typeof this.model.procedure.body === 'string' ? this.model.procedure.body : '');
    }

    public async update(_context: IActionContext, content: string): Promise<void> {
        const { endpoint, credentials, isEmulator } = this.model.accountInfo;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
        const replace = await cosmosClient
            .database(this.model.database.id)
            .container(this.model.container.id)
            .scripts.storedProcedure(this.model.procedure.id)
            .replace({ id: this.model.procedure.id, body: content });
        this.model.procedure = nonNullProp(replace, 'resource');
    }
}
