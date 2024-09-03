/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { postgresFlexibleFilter, postgresSingleFilter } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { PostgresServerType } from '../abstract/models';
import  { type PostgresServerTreeItem } from '../tree/PostgresServerTreeItem';
import { setPostgresCredentials } from './setPostgresCredentials';

/**
 * Get the username and password for the Postgres database from user input.
 */
async function getUsernamePassword(
    context: IActionContext,
    serverType: PostgresServerType,
    serverName: string,
    serverDisplayName: string,
): Promise<{ username: string; password: string }> {
    let username: string = await context.ui.showInputBox({
        prompt: localize('enterUsername', 'Enter username for server "{0}"', serverDisplayName),
        stepName: 'enterPostgresUsername',
        validateInput: (value: string) => {
            return value && value.length ? undefined : localize('usernameCannotBeEmpty', 'Username cannot be empty.');
        },
    });

    // Username doesn't contain servername prefix for Postgres Flexible Servers only
    // As present on the portal for any Flexible Server instance
    const usernameSuffix: string = `@${serverName}`;
    if (serverType === PostgresServerType.Single && !username.includes(usernameSuffix)) {
        username += usernameSuffix;
    }

    const password: string = await context.ui.showInputBox({
        prompt: localize('enterPassword', 'Enter password for server "{0}"', serverDisplayName),
        stepName: 'enterPostgresPassword',
        password: true,
        validateInput: (value: string) => {
            return value && value.length ? undefined : localize('passwordCannotBeEmpty', 'Password cannot be empty.');
        },
    });

    return { username, password };
}

/**
 * Save the username and password in secure local storage.
 */
async function persistUsernamePassword(
    id: string,
    serverName: string,
    username: string,
    password: string,
): Promise<void> {
    const progressMessage: string = localize(
        'setupCredentialsMessage',
        'Setting up credentials for server "{0}"...',
        serverName,
    );
    const options: vscode.ProgressOptions = {
        location: vscode.ProgressLocation.Notification,
        title: progressMessage,
    };

    await vscode.window.withProgress(options, async () => {
        await setPostgresCredentials(username, password, id);
    });

    const completedMessage: string = localize(
        'setupCredentialsMessage',
        'Successfully added credentials to server "{0}".',
        serverName,
    );
    void vscode.window.showInformationMessage(completedMessage);
    ext.outputChannel.appendLog(completedMessage);
}

export async function enterPostgresCredentials(
    context: IActionContext,
    treeItem?: PostgresServerTreeItem,
): Promise<void> {
    if (!treeItem) {
        treeItem = await ext.rgApi.pickAppResource<PostgresServerTreeItem>(context, {
            filter: [postgresSingleFilter, postgresFlexibleFilter],
        });
    }

    const serverType = treeItem.serverType;
    const serverName: string = nonNullProp(treeItem, 'azureName');
    const serverDisplayName: string = treeItem.label;
    const id: string = nonNullProp(treeItem, 'id');

    const { username, password } = await getUsernamePassword(context, serverType, serverName, serverDisplayName);

    await persistUsernamePassword(id, serverName, username, password);

    treeItem.setCredentials(username, password);
    await treeItem.refresh(context);
}
