/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Root entry point — re-exports the shared (side-independent) surface of
 * `@cosmosdb/webview-rpc`. For side-specific imports, use the subpath
 * entries:
 *
 * - `@cosmosdb/webview-rpc/server` for extension-host code (`vscode` API + Node).
 * - `@cosmosdb/webview-rpc/client` for webview code (browser, no `vscode` API).
 * - `@cosmosdb/webview-rpc/react` for React bindings on top of `/client`.
 */

export * from './shared/TypedEventSink';
export * from './shared/vscodeProtocol';
