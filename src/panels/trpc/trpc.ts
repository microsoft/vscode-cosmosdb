/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * tRPC instance configuration.
 *
 * Each webview type (Query Editor, Document, Migration Assistant) gets
 * its own tRPC instance with a properly typed context. This eliminates
 * the need for middleware-based context casting (`next({ ctx: ctx as T })`)
 * and avoids the shallow-copy problem that such middleware introduces.
 *
 * All instances share the same observability stack, wired
 * directly per-instance below:
 *
 *  1. **Logging middleware** — `loggingMiddlewareBody` + the cosmosdb-
 *     specific `outputChannelProcedureLogger` (writes to
 *     `ext.outputChannel`). Generic, no telemetry-backend dependency.
 *  2. **Telemetry middleware** — a typed tRPC adapter + the
 *     cosmosdb-specific `azextTelemetryRunner` (uses
 *     `callWithTelemetryAndErrorHandling` from
 *     `@microsoft/vscode-azext-utils`). Wraps every procedure in an
 *     `IActionContext` and surfaces it on `ctx.actionContext`.
 *
 * `loggingMiddlewareBody` comes from `@microsoft/vscode-ext-webview/host`.
 * The telemetry adapter uses tRPC's context override type so subsequent
 * middleware and procedures know that `actionContext` is required.
 *
 * Procedures access:
 *  - `ctx.actionContext` — full `IActionContext`, populated by the
 *    azext telemetry runner. Use for `errorHandling.suppressDisplay`,
 *    `telemetry.suppressIfSuccessful`, etc.
 *  - `ctx.actionContext.telemetry` — properties and measurements for
 *    the current invocation.
 *
 * @see https://trpc.io/docs/v11/router
 * @see https://trpc.io/docs/v11/procedures
 */

import { initWebviewTrpc } from '@microsoft/vscode-ext-webview';
import { loggingMiddlewareBody, type ProcedureInvocation } from '@microsoft/vscode-ext-webview/host';
import { type TRPCMiddlewareFunction } from '@trpc/server';
import {
    type AccountOverviewRouterContext,
    type DataModelingRouterContext,
    type DocumentRouterContext,
    type MigrationRouterContext,
    type QueryEditorRouterContext,
} from './appRouter';
import { accountOverviewTelemetryMiddleware } from './middleware/accountOverviewTelemetryMiddleware';
import { azextTelemetryRunner, type AzextTelemetryEnrichment } from './middleware/azextTelemetryRunner';
import { outputChannelProcedureLogger } from './middleware/outputChannelLogger';

// ─── Shared observability wiring ────────────────────────────────────────────

/** Project-wide telemetry event id format: `cosmosDB.rpc.${type}.${path}`. */
function buildCosmosDbEventId({ type, path }: ProcedureInvocation): string {
    return `cosmosDB.rpc.${type}.${path}`;
}

// The two middleware bodies are *ctx-agnostic* — they're plain async
// functions whose only contract with tRPC is structural (`path`, `type`,
// `next`). We wire them onto each instance's `publicProcedure` so the
// bound types stay precise per webview.
//
// We deliberately inline the `.use(...)` chain at each instance instead of
// hiding it behind a generic helper: tRPC's `ProcedureBuilder` is a
// deep-generic type whose inference collapses to `any` the moment a
// helper widens its return type, which in turn would erase the typed
// router shape downstream (e.g. `trpcClient.foo.query` would lose
// `input`/`output` typing). Two near-identical lines per instance is
// the price of that precision.

type AzextTelemetryMiddleware = TRPCMiddlewareFunction<object, object, object, AzextTelemetryEnrichment, unknown>;

// The framework's structural telemetry body erases context overrides.
// Keep the typed next({ ctx }) call here so tRPC carries the enrichment through each procedure chain.
const sharedTelemetryBody: AzextTelemetryMiddleware = (invocation) =>
    azextTelemetryRunner.run(buildCosmosDbEventId(invocation), invocation, (enrichment) =>
        invocation.next({ ctx: enrichment }),
    );

// ─── Query Editor tRPC Instance ─────────────────────────────────────────────

const queryEditorT = initWebviewTrpc<QueryEditorRouterContext>();

/** Base procedure with logging + telemetry middleware already applied. */
export const queryEditorProcedure = queryEditorT.publicProcedure
    .use((opts) => loggingMiddlewareBody(opts, outputChannelProcedureLogger))
    .use(sharedTelemetryBody);
export const queryEditorRouter = queryEditorT.router;
export const queryEditorMergeRouters = queryEditorT.mergeRouters;
export const queryEditorCallerFactory = queryEditorT.createCallerFactory;

// ─── Document tRPC Instance ─────────────────────────────────────────────────

const documentT = initWebviewTrpc<DocumentRouterContext>();

/** Base procedure with logging + telemetry middleware already applied. */
export const documentProcedure = documentT.publicProcedure
    .use((opts) => loggingMiddlewareBody(opts, outputChannelProcedureLogger))
    .use(sharedTelemetryBody);
export const documentRouter = documentT.router;
export const documentCallerFactory = documentT.createCallerFactory;

// ─── Migration Assistant tRPC Instance ──────────────────────────────────────

const migrationT = initWebviewTrpc<MigrationRouterContext>();

/** Base procedure with logging + telemetry middleware already applied. */
export const migrationProcedure = migrationT.publicProcedure
    .use((opts) => loggingMiddlewareBody(opts, outputChannelProcedureLogger))
    .use(sharedTelemetryBody);
export const migrationRouter = migrationT.router;
export const migrationMergeRouters = migrationT.mergeRouters;
export const migrationCallerFactory = migrationT.createCallerFactory;

// ─── Account Overview tRPC Instance ─────────────────────────────────────────

const accountOverviewT = initWebviewTrpc<AccountOverviewRouterContext>();

/** Base procedure with logging + telemetry middleware already applied. */
export const accountOverviewProcedure = accountOverviewT.publicProcedure
    .use((opts) => loggingMiddlewareBody(opts, outputChannelProcedureLogger))
    .use(sharedTelemetryBody)
    .use(accountOverviewTelemetryMiddleware);
export const accountOverviewRouter = accountOverviewT.router;
export const accountOverviewCallerFactory = accountOverviewT.createCallerFactory;

// ─── Data Modeling tRPC Instance ────────────────────────────────────────────

const dataModelingT = initWebviewTrpc<DataModelingRouterContext>();

/** Base procedure with logging + telemetry middleware already applied. */
export const dataModelingProcedure = dataModelingT.publicProcedure
    .use((opts) => loggingMiddlewareBody(opts, outputChannelProcedureLogger))
    .use(sharedTelemetryBody);
export const dataModelingRouter = dataModelingT.router;
export const dataModelingMergeRouters = dataModelingT.mergeRouters;
export const dataModelingCallerFactory = dataModelingT.createCallerFactory;
