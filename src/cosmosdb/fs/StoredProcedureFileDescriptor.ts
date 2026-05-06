/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Experience } from '../../AzureDBExperiences';
import { type EditableFileSystemItem } from '../../DatabasesFileSystem';
import { type CosmosDBStoredProcedureModel } from '../../tree/cosmosdb/models/CosmosDBStoredProcedureModel';
import { getControlPlane } from '../controlPlane';

export class StoredProcedureFileDescriptor implements EditableFileSystemItem {
    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    constructor(
        public readonly id: string,
        public readonly model: CosmosDBStoredProcedureModel,
        public readonly experience: Experience,
    ) {}

    public get filePath(): string {
        return this.model.procedure.id + '-cosmos-stored-procedure.js';
    }

    public getFileContent(): Promise<string> {
        return Promise.resolve(typeof this.model.procedure.body === 'string' ? this.model.procedure.body : '');
    }

    public async writeFileContent(_context: IActionContext, content: string): Promise<void> {
        const controlPlane = getControlPlane(this.model.accountInfo);
        this.model.procedure = await controlPlane.replaceStoredProcedure(
            this.model.database.id,
            this.model.container.id,
            { id: this.model.procedure.id, body: content },
        );
    }
}
