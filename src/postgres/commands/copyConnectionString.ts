/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { addDatabaseToConnectionString, buildPostgresConnectionString } from '../postgresConnectionStrings';
import { PostgresDatabaseTreeItem } from '../tree/PostgresDatabaseTreeItem';
import { checkAuthentication } from './checkAuthentication';

export async function copyConnectionString(context: IActionContext, node: PostgresDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = await ext.rgApi.pickAppResource<PostgresDatabaseTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
            expectedChildContextValue: PostgresDatabaseTreeItem.contextValue,
        });
    }

    await checkAuthentication(context, node);
    const parsedConnectionString = await node.parent.getFullConnectionString();
    let connectionString: string;
    if (node.parent.azureName) {
        const parsedCS = await node.parent.getFullConnectionString();
        connectionString = buildPostgresConnectionString(
            parsedCS.hostName,
            parsedCS.port,
            parsedCS.username,
            parsedCS.password,
            node.databaseName,
        );
    } else {
        connectionString = addDatabaseToConnectionString(parsedConnectionString.connectionString, node.databaseName);
    }

    await vscode.env.clipboard.writeText(connectionString);
    const message = l10n.t('The connection string has been copied to the clipboard');
    void vscode.window.showInformationMessage(message);
}
