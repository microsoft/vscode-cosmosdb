/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Webview entry point. Re-exports the client-side surface (browser-safe;
 * no `vscode` API).
 *
 * The shared wire-protocol types are re-exported from the package root
 * (`@cosmosdb/webview-rpc`).
 */

export * from './vscodeLink';
export * from './errorLink';
export * from './events';
