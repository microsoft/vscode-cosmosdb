/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { type PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { type PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';
import { connectPostgresDatabase } from './connectPostgresDatabase';

export async function createPostgresDatabase(context: IActionContext, node?: PostgresServerTreeItem): Promise<void> {
    if (!node) {
        node = await ext.rgApi.pickAppResource<PostgresServerTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
        });
    }
    const newDatabase: PostgresDatabaseTreeItem = await node.createChild(context);
    await connectPostgresDatabase(context, newDatabase);
    const createMessage: string = vscode.l10n.t('Successfully created database "{0}".', newDatabase.databaseName);
    void vscode.window.showInformationMessage(createMessage);
    ext.outputChannel.appendLog(createMessage);
}
