/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuid } from 'uuid';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type DocumentDBStoredProcedureModel } from './models/DocumentDBStoredProcedureModel';

export abstract class DocumentDBStoredProcedureResourceItem implements CosmosDBTreeElement {
    public id: string;
    public contextValue: string = 'cosmosDB.item.storedProcedure';

    protected constructor(
        protected readonly model: DocumentDBStoredProcedureModel,
        protected readonly experience: Experience,
    ) {
        this.id = uuid();
        this.contextValue = `${experience.api}.item.storedProcedure`;
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
}
