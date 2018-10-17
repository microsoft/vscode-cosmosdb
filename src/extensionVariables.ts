/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext, OutputChannel, TreeView } from "vscode";
import { AzureTreeDataProvider, AzureTreeItem, IAzureUserInput, ISubscriptionRoot } from "vscode-azureextensionui";
import TelemetryReporter from "vscode-extension-telemetry";
import { MongoDatabaseTreeItem } from "./mongo/tree/MongoDatabaseTreeItem";

/**
 * Namespace for common variables used throughout the extension. They must be initialized in the activate() method of extension.ts
 */
export namespace ext {
    export let connectedMongoDB: MongoDatabaseTreeItem | undefined;
    export let ui: IAzureUserInput;
    export let context: ExtensionContext;
    export let outputChannel: OutputChannel;
    export let reporter: TelemetryReporter | undefined;
    export let tree: AzureTreeDataProvider;
    export let cosmosView: TreeView<AzureTreeItem<ISubscriptionRoot>>;

    export namespace settingsKeys {
        export const mongoShellPath = 'mongo.shell.path';
        export const documentLabelFields = 'cosmosDB.documentLabelFields';

        export namespace vsCode {
            export const proxyStrictSSL = "http.proxyStrictSSL";
        }
    }
}
