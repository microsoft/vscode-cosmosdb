/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Root entry point — re-exports the shared (side-independent) surface of
 * `@microsoft/vscode-webview-rpc`. For side-specific imports, use the subpath
 * entries:
 *
 * - `@microsoft/vscode-webview-rpc/server` for extension-host code (`vscode` API + Node).
 * - `@microsoft/vscode-webview-rpc/client` for webview code (browser, no `vscode` API).
 * - `@microsoft/vscode-webview-rpc/react` for React bindings on top of `/client`.
 */

export * from './shared/TypedEventSink';
export * from './shared/vscodeProtocol';
