/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, type IActionContext } from '@microsoft/vscode-azext-utils';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type EditableTreeItem } from '../../DatabasesFileSystem';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { nonNullProp } from '../../utils/nonNull';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type DocumentDBStoredProcedureModel } from './models/DocumentDBStoredProcedureModel';

export abstract class DocumentDBStoredProcedureResourceItem
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue, EditableTreeItem
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.storedProcedure';

    public readonly cTime: number = Date.now();
    public mTime: number = Date.now();

    protected constructor(
        public readonly model: DocumentDBStoredProcedureModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}/storedProcedures/${model.procedure.id}`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('server-process'),
            label: this.model.procedure.id,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                title: 'Open Stored Procedure',
                command: 'cosmosDB.openStoredProcedure',
            },
        };
    }

    public get filePath(): string {
        return this.model.procedure.id + '-cosmos-stored-procedure.js';
    }

    public getFileContent(): Promise<string> {
        return Promise.resolve(typeof this.model.procedure.body === 'string' ? this.model.procedure.body : '');
    }

    public async writeFileContent(_context: IActionContext, content: string): Promise<void> {
        const { endpoint, credentials, isEmulator } = this.model.accountInfo;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
        const replace = await cosmosClient
            .database(this.model.database.id)
            .container(this.model.container.id)
            .scripts.storedProcedure(this.id)
            .replace({ id: this.id, body: content });
        this.model.procedure = nonNullProp(replace, 'resource');
    }
}
