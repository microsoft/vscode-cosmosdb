/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from "azure-arm-postgresql/lib/models";
import { IActionContext } from "vscode-azureextensionui";
import { ext } from "../../extensionVariables";
import { localize } from "../../utils/localize";
import { nonNullProp } from "../../utils/nonNull";
import { PostgresServerTreeItem } from "../tree/PostgresServerTreeItem";
import { setPostgresCredentials } from "./setPostgresCredentials";

export async function enterPostgresCredentials(context: IActionContext, treeItem?: PostgresServerTreeItem): Promise<void> {
    if (!treeItem) {
        treeItem = <PostgresServerTreeItem>await ext.tree.showTreeItemPicker(PostgresServerTreeItem.contextValue, context);
    }

    let username: string = await ext.ui.showInputBox({
        prompt: localize('enterUsername', 'Enter username for server "{0}"', treeItem.label),
        validateInput: (value: string) => { return (value && value.length) ? undefined : localize('usernameCannotBeEmpty', 'Username cannot be empty.'); }
    });

    const usernameSuffix: string = `@${treeItem.server.name}`;
    if (!username.includes(usernameSuffix)) {
        username += usernameSuffix;
    }

    const password: string = await ext.ui.showInputBox({
        prompt: localize('enterPassword', 'Enter password for server "{0}"', treeItem.label),
        password: true,
        validateInput: (value: string) => { return (value && value.length) ? undefined : localize('passwordCannotBeEmpty', 'Password cannot be empty.'); }
    });

    const server: Server = nonNullProp(treeItem, 'server');
    await setPostgresCredentials(username, password, nonNullProp(server, 'id'));
    await treeItem.refresh();
}
