/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext, TreeView } from "vscode";
import { AzExtTreeDataProvider, AzExtTreeItem, IAzExtOutputChannel, IAzureUserInput, ITelemetryReporter } from "vscode-azureextensionui";
import { EditorManager } from "./EditorManager";
import { MongoDatabaseTreeItem } from "./mongo/tree/MongoDatabaseTreeItem";
import { AttachedAccountsTreeItem } from "./tree/AttachedAccountsTreeItem";
import { AzureAccountTreeItemWithAttached } from "./tree/AzureAccountTreeItemWithAttached";
import { KeyTar } from "./utils/keytar";

/**
 * Namespace for common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 */
export namespace ext {
    export let connectedMongoDB: MongoDatabaseTreeItem | undefined;
    export let ui: IAzureUserInput;
    export let context: ExtensionContext;
    export let outputChannel: IAzExtOutputChannel;
    export let reporter: ITelemetryReporter;
    export let tree: AzExtTreeDataProvider;
    export let treeView: TreeView<AzExtTreeItem>;
    export let attachedAccountsNode: AttachedAccountsTreeItem;
    export let ignoreBundle: boolean | undefined;
    export let azureAccountTreeItem: AzureAccountTreeItemWithAttached;
    export let editorManager: EditorManager;
    export let keytar: KeyTar | undefined;

    export namespace settingsKeys {
        export const mongoShellPath = 'mongo.shell.path';
        export const mongoShellArgs = 'mongo.shell.args';
        export const documentLabelFields = 'cosmosDB.documentLabelFields';
        export const mongoShellTimeout = 'mongo.shell.timeout';

        export namespace vsCode {
            export const proxyStrictSSL = "http.proxyStrictSSL";
        }
    }
}
