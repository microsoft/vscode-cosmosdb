/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// #region example
import * as cosmosDbSql from '@azure/cosmosdb-nosql-language-service/vscode';
import * as vscode from 'vscode';
import { createSession } from '../src/session';

// #region vscode-extension
/**
 * Call from activate(context) with JSON documents chosen by the host.
 * vscode is provided by the extension host, not a browser dependency.
 */
export function registerSqlExtension(
    context: vscode.ExtensionContext,
    documentsJson: string,
): vscode.Disposable {
    // This shared helper creates a service whose getSchema callback reads
    // the current inferred schema. Applying documents supplies field names
    // and type information before we register editor features.
    const session = createSession();
    session.applyDocuments(documentsJson);

    // Contribute "cosmosdb-sql" in the manifest, e.g. for .nosql files.
    // The helper registers providers and adds its disposable to
    // context.subscriptions, so VS Code cleans up on deactivation.
    return cosmosDbSql.registerCosmosDbSql(vscode, session.service, context);
}
// #endregion vscode-extension
// #endregion example
