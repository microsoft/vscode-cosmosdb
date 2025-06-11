/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getThemedIconPath } from '../../constants';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type CosmosDBQueryEditorModel } from './models/CosmosDBQueryEditorModel';

export abstract class CosmosDBQueryEditorResourceItem
    implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.queryEditor';

    protected constructor(
        public readonly model: CosmosDBQueryEditorModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}/queryEditor`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: getThemedIconPath('search_database_16.svg'),
            label: 'Query Editor',
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                title: l10n.t('Open Query Editor'),
                command: 'cosmosDB.openNoSqlQueryEditor',
                arguments: [this],
            },
        };
    }
}
