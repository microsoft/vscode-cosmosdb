/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extension-host entry point. Re-exports the server-side surface for use
 * in code that runs in the Node.js extension host (depends on `vscode`).
 *
 * The shared wire-protocol types are re-exported from the package root
 * (`@cosmosdb/webview-rpc`).
 */

export * from './baseRouterContext';
export * from './setupTrpc';
export * from './middleware';

// Re-export shared protocol types so server code can import everything
// from a single subpath if it prefers.
export type { VsCodeLinkRequestMessage, VsCodeLinkResponseMessage } from '../shared/vscodeProtocol';

// Re-export the tRPC builder + base router type. Consumers wire their
// own `initTRPC.context<T>().create()` instances (one per webview, so
// each gets a precisely-typed router/procedure) — exposing them here
// keeps `@trpc/server` an implementation detail of this package: the
// host extension can stay tRPC-agnostic at the import level.
export { initTRPC, type AnyRouter } from '@trpc/server';
