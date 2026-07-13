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
 * All three instances share the same observability stack, wired
 * directly per-instance below:
 *
 *  1. **Logging middleware** — `loggingMiddlewareBody` + the cosmosdb-
 *     specific `outputChannelProcedureLogger` (writes to
 *     `ext.outputChannel`). Generic, no telemetry-backend dependency.
 *  2. **Telemetry middleware** — `telemetryMiddlewareBody` + the
 *     cosmosdb-specific `azextTelemetryRunner` (uses
 *     `callWithTelemetryAndErrorHandling` from
 *     `@microsoft/vscode-azext-utils`). Wraps every procedure in an
 *     `IActionContext` and surfaces it on `ctx.actionContext` /
 *     `ctx.telemetry`.
 *
 * The middleware **factories** live under `./middleware/`. They are
 * framework-level and dependency-free, so they could be lifted into a
 * shared package without dragging cosmosdb-specific code along — see
 * `plans/webview-vs-documentdb-package.md`.
 *
 * Procedures access:
 *  - `ctx.actionContext` — full `IActionContext`, populated by the
 *    azext telemetry runner. Use for `errorHandling.suppressDisplay`,
 *    `telemetry.suppressIfSuccessful`, etc.
 *  - `ctx.telemetry` — `properties`/`measurements` for fire-and-forget
 *    metadata attachments (same object as `ctx.actionContext.telemetry`).
 *
 * @see https://trpc.io/docs/v11/router
 * @see https://trpc.io/docs/v11/procedures
 */

import {
    initTRPC,
    loggingMiddlewareBody,
    type ProcedureInvocation,
    telemetryMiddlewareBody,
} from '@cosmosdb/webview-rpc/server';
import {
    type AccountOverviewRouterContext,
    type DocumentRouterContext,
    type MigrationRouterContext,
    type QueryEditorRouterContext,
} from './appRouter';
import { azextTelemetryRunner } from './middleware/azextTelemetryRunner';
import { outputChannelProcedureLogger } from './middleware/outputChannelLogger';

// ─── Shared observability wiring ────────────────────────────────────────────

/** Project-wide telemetry event id format: `cosmosDB.rpc.${type}.${path}`. */
function buildCosmosDbEventId({ type, path }: ProcedureInvocation): string {
    return `cosmosDB.rpc.${type}.${path}`;
}

// The two middleware bodies are *ctx-agnostic* — they're plain async
// functions whose only contract with tRPC is structural (`path`, `type`,
// `next`). Each tRPC instance wraps them with its own `t.middleware(...)`
// so the bound types stay precise per webview.
//
// We deliberately inline the `.use(...)` chain at each instance instead of
// hiding it behind a generic helper: tRPC's `ProcedureBuilder` is a
// deep-generic type whose inference collapses to `any` the moment a
// helper widens its return type, which in turn would erase the typed
// router shape downstream (e.g. `trpcClient.foo.query` would lose
// `input`/`output` typing). Three near-identical lines per instance is
// the price of that precision.

const sharedLoggingBody = loggingMiddlewareBody(outputChannelProcedureLogger);
const sharedTelemetryBody = telemetryMiddlewareBody(azextTelemetryRunner, {
    buildEventId: buildCosmosDbEventId,
});

// ─── Query Editor tRPC Instance ─────────────────────────────────────────────

const queryEditorT = initTRPC.context<QueryEditorRouterContext>().create();

/** Base procedure with logging + telemetry middleware already applied. */
export const queryEditorProcedure = queryEditorT.procedure
    .use(queryEditorT.middleware(sharedLoggingBody))
    .use(queryEditorT.middleware(sharedTelemetryBody));
export const queryEditorRouter = queryEditorT.router;
export const queryEditorMergeRouters = queryEditorT.mergeRouters;
export const queryEditorCallerFactory = queryEditorT.createCallerFactory;

// ─── Document tRPC Instance ─────────────────────────────────────────────────

const documentT = initTRPC.context<DocumentRouterContext>().create();

/** Base procedure with logging + telemetry middleware already applied. */
export const documentProcedure = documentT.procedure
    .use(documentT.middleware(sharedLoggingBody))
    .use(documentT.middleware(sharedTelemetryBody));
export const documentRouter = documentT.router;
export const documentCallerFactory = documentT.createCallerFactory;

// ─── Migration Assistant tRPC Instance ──────────────────────────────────────

const migrationT = initTRPC.context<MigrationRouterContext>().create();

/** Base procedure with logging + telemetry middleware already applied. */
export const migrationProcedure = migrationT.procedure
    .use(migrationT.middleware(sharedLoggingBody))
    .use(migrationT.middleware(sharedTelemetryBody));
export const migrationRouter = migrationT.router;
export const migrationMergeRouters = migrationT.mergeRouters;
export const migrationCallerFactory = migrationT.createCallerFactory;

// ─── Account Overview tRPC Instance ─────────────────────────────────────────

const accountOverviewT = initTRPC.context<AccountOverviewRouterContext>().create();

/** Base procedure with logging + telemetry middleware already applied. */
export const accountOverviewProcedure = accountOverviewT.procedure
    .use(accountOverviewT.middleware(sharedLoggingBody))
    .use(accountOverviewT.middleware(sharedTelemetryBody));
export const accountOverviewRouter = accountOverviewT.router;
export const accountOverviewCallerFactory = accountOverviewT.createCallerFactory;
