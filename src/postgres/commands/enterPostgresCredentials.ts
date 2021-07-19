/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { nonNullProp } from '../../utils/nonNull';
import { PostgresServerType } from '../abstract/models';
import { PostgresServerTreeItem } from "../tree/PostgresServerTreeItem";
import { setPostgresCredentials } from "./setPostgresCredentials";

export async function enterPostgresCredentials(context: IActionContext, treeItem?: PostgresServerTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }

    let username: string = await context.ui.showInputBox({
        prompt: localize('enterUsername', 'Enter username for server "{0}"', treeItem.label),
        stepName: 'enterPostgresUsername',
        validateInput: (value: string) => { return (value && value.length) ? undefined : localize('usernameCannotBeEmpty', 'Username cannot be empty.'); }
    });

    const serverName: string = nonNullProp(treeItem, 'azureName');
    // Username doesn't contain servername prefix for Postgres Flexible Servers only
    // As present on the portal for any Flexbile Server instance
    const usernameSuffix: string = `@${serverName}`;
    if (treeItem.serverType === PostgresServerType.Single && !username.includes(usernameSuffix)) {
        username += usernameSuffix;
    }

    const password: string = await context.ui.showInputBox({
        prompt: localize('enterPassword', 'Enter password for server "{0}"', treeItem.label),
        stepName: 'enterPostgresPassword',
        password: true,
        validateInput: (value: string) => { return (value && value.length) ? undefined : localize('passwordCannotBeEmpty', 'Password cannot be empty.'); }
    });

    const id: string = nonNullProp(treeItem, 'id');

    const progressMessage: string = localize('setupCredentialsMessage', 'Setting up credentials for server "{0}"...', serverName);
    const options: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: progressMessage
    };

    await vscode.window.withProgress(options, async () => {
        await setPostgresCredentials(username, password, id);
    });

    const completedMessage: string = localize('setupCredentialsMessage', 'Successfully added credentials to server "{0}".', serverName);
    void vscode.window.showInformationMessage(completedMessage);
    ext.outputChannel.appendLog(completedMessage);

    treeItem.setCredentials(username, password);

    await treeItem.refresh(context);
}
