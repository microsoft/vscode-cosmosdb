/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-webview tRPC routers.
 *
 * Each webview type has its own app router built from its own tRPC instance
 * (see trpc.ts). Common procedures are inlined per-instance via
 * {@link buildCommonRouter} so that they share the same context type.
 */

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { type TypedEventSink } from '@cosmosdb/webview-rpc';
import { type BaseRouterContext } from '@cosmosdb/webview-rpc/server';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type AzureResourceMetadata } from '../../cosmosdb/AzureResourceMetadata';
import { type NoSqlQueryConnection } from '../../cosmosdb/NoSqlQueryConnection';
import { type QuerySession } from '../../cosmosdb/session/QuerySession';
import { type CosmosDBRecordIdentifier } from '../../cosmosdb/types/queryResult';
import { type TelemetryContext } from '../../Telemetry';
import { openSurvey, promptAfterActionEventually } from '../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../utils/surveyTypes';
import { accountOverviewRouterDef } from './routers/accountOverviewRouter';
import { documentRouterDef } from './routers/documentRouter';
import { migrationEventsRouterDef, type MigrationEvent } from './routers/migrationEventsRouter';
import { migrationRouterDef } from './routers/migrationRouter';
import { queryEditorEventsRouterDef, type QueryEditorEvent } from './routers/queryEditorEventsRouter';
import { queryEditorRouterDef } from './routers/queryEditorRouter';
import {
    accountOverviewCallerFactory,
    accountOverviewProcedure,
    accountOverviewRouter,
    documentCallerFactory,
    documentProcedure,
    documentRouter,
    migrationCallerFactory,
    migrationMergeRouters,
    migrationProcedure,
    migrationRouter,
    queryEditorCallerFactory,
    queryEditorMergeRouters,
    queryEditorProcedure,
    queryEditorRouter,
} from './trpc';

// ─── Context Types ──────────────────────────────────────────────────────────

/**
 * Cosmosdb-specific extension of the framework-level
 * {@link BaseRouterContext}. Carries everything our procedures expect
 * beyond what the transport layer provides:
 *
 *  - `webviewName` — the panel/webview identifier. Used by common procedures
 *    in {@link buildCommonRouter} to build telemetry event ids
 *    (`cosmosDB.NoSQL.webview.event.${webviewName}.${eventName}`).
 *
 *  - `actionContext` — the full `IActionContext` from
 *    `@microsoft/vscode-azext-utils`, populated by `telemetryMiddlewareImpl`
 *    in `trpc.ts`. Use this when you need azext-utils features beyond
 *    plain telemetry — for example, `actionContext.errorHandling
 *    .suppressDisplay`, `.telemetry.suppressIfSuccessful`, or to thread
 *    the context into another `callWithTelemetryAndErrorHandling`-aware
 *    helper. For just setting telemetry `properties`/`measurements`, you
 *    can also read the inherited base-level `ctx.telemetry` once a
 *    middleware populates it.
 *
 * `IActionContext.telemetry` structurally satisfies the base
 * {@link import('./baseRouterContext').TelemetryContext} shape, but we
 * intentionally do not alias the field — keeping `actionContext` as a
 * separate, richer field makes the dependency on azext-utils explicit
 * at the read site.
 */
export interface CosmosDBRouterContext extends BaseRouterContext {
    webviewName: string;
    actionContext?: IActionContext;
}

export type QueryEditorMutableState = {
    connection?: NoSqlQueryConnection;
    query?: string;
    selectedQuery?: string;
    isLastQueryAIGenerated: boolean;
    lastAIGeneratedQuery?: string;
    /**
     * The natural-language prompt captured by the in-editor "Generate query" flow. Stored so the
     * `cosmosdb_applyQueryToEditor` tool can cite the original request in the query comments even
     * when the agent does not pass it explicitly.
     */
    lastGeneratePrompt?: string;
    /**
     * Resolver for the promise the `cosmosdb_executeCurrentQuery` tool awaits while the webview runs the
     * active query. The `reportActiveQueryExecuted` procedure calls it once execution finishes.
     */
    pendingRunResolve?: () => void;
};

export type QueryEditorRouterContext = CosmosDBRouterContext & {
    sessions: Map<string, QuerySession>;
    telemetryContext: TelemetryContext;
    panel: vscode.WebviewPanel;
    eventSink: TypedEventSink<QueryEditorEvent>;
    state: QueryEditorMutableState;
};

export type DocumentMutableState = {
    mode: 'add' | 'edit' | 'view';
    documentId: CosmosDBRecordIdentifier | undefined;
    isDirty: boolean;
    partitionKeyDefinition?: PartitionKeyDefinition;
};

export type DocumentRouterContext = CosmosDBRouterContext & {
    connection: NoSqlQueryConnection;
    telemetryContext: TelemetryContext;
    panel: vscode.WebviewPanel;
    state: DocumentMutableState;
};

/**
 * Dispatcher invoked by the generic migration `command` procedure. The
 * MigrationAssistantTab implements it as a large switch over `commandName`.
 * It returns `unknown` because each command produces a different shape; the
 * webview side knows what to expect per command. Returning `undefined` is
 * common for fire-and-forget commands.
 */
export type MigrationCommandDispatcher = (commandName: string, params: unknown[]) => Promise<unknown>;

export type MigrationRouterContext = CosmosDBRouterContext & {
    telemetryContext: TelemetryContext;
    panel: vscode.WebviewPanel;
    eventSink: TypedEventSink<MigrationEvent>;
    dispatchCommand: MigrationCommandDispatcher;
};

export type AccountOverviewRouterContext = CosmosDBRouterContext & {
    metadata: AzureResourceMetadata;
};

// ─── Common Procedures (per-instance) ───────────────────────────────────────

/**
 * Builds common procedures using the given tRPC instance tools.
 * This is called once per tRPC instance so the procedures share the
 * instance's context type (QueryEditorRouterContext or DocumentRouterContext).
 *
 * Common procedures only access `ctx.webviewName`, which lives on
 * {@link CosmosDBRouterContext}, so they work with any context that
 * extends it.
 *
 * Telemetry middleware is already baked into each procedure, so individual
 * `.use(trpcToTelemetry)` calls are not needed here.
 */

/* oxlint-disable typescript/no-explicit-any, typescript/no-unsafe-call, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-return -- tRPC builder types are too generic to express without `any` */
function buildCommonRouter(procedure: any, routerFn: any) {
    return routerFn({
        reportEvent: procedure
            .input(
                z.object({
                    eventName: z.string(),
                    properties: z.optional(z.record(z.string(), z.string())),
                    measurements: z.optional(z.record(z.string(), z.number())),
                }),
            )
            .mutation(
                ({
                    input,
                    ctx,
                }: {
                    input: {
                        eventName: string;
                        properties?: Record<string, string>;
                        measurements?: Record<string, number>;
                    };
                    ctx: CosmosDBRouterContext;
                }) => {
                    void callWithTelemetryAndErrorHandling<void>(
                        `cosmosDB.NoSQL.webview.event.${ctx.webviewName}.${input.eventName}`,
                        (context) => {
                            context.errorHandling.suppressDisplay = true;
                            context.telemetry.properties.experience = 'NoSQL';
                            Object.assign(context.telemetry.properties, input.properties ?? {});
                            Object.assign(context.telemetry.measurements, input.measurements ?? {});
                        },
                    );
                },
            ),

        reportError: procedure
            .input(
                z.object({
                    message: z.string(),
                    stack: z.string(),
                    componentStack: z.optional(z.string()),
                    properties: z.optional(z.record(z.string(), z.string())),
                }),
            )
            .mutation(
                ({
                    input,
                    ctx,
                }: {
                    input: {
                        message: string;
                        stack: string;
                        componentStack?: string;
                        properties?: Record<string, string>;
                    };
                    ctx: CosmosDBRouterContext;
                }) => {
                    void callWithTelemetryAndErrorHandling<void>(
                        `cosmosDB.NoSQL.webview.error.${ctx.webviewName}`,
                        (context) => {
                            context.errorHandling.suppressDisplay = true;
                            context.telemetry.properties.experience = 'NoSQL';

                            Object.assign(context.telemetry.properties, input.properties ?? {});

                            const newError = new Error(input.message);
                            newError.stack = input.componentStack ?? input.stack;
                            throw newError;
                        },
                    );
                },
            ),

        displayErrorMessage: procedure
            .input(
                z.object({
                    message: z.string(),
                    modal: z.boolean(),
                    cause: z.string(),
                }),
            )
            .mutation(({ input }: { input: { message: string; modal: boolean; cause: string } }) => {
                let message = input.message;
                if (input.cause && !input.modal) {
                    message += ` (${input.cause})`;
                }

                void vscode.window.showErrorMessage(message, {
                    modal: input.modal,
                    detail: input.modal ? input.cause : undefined,
                });
            }),

        surveyPing: procedure
            .input(
                z.object({
                    experienceKind: z.enum([ExperienceKind.Mongo, ExperienceKind.NoSQL]),
                    usageImpact: z.union([
                        z.literal(UsageImpact.Low),
                        z.literal(UsageImpact.Medium),
                        z.literal(UsageImpact.High),
                    ]),
                }),
            )
            .mutation(({ input }: { input: { experienceKind: ExperienceKind; usageImpact: number } }) => {
                void promptAfterActionEventually(input.experienceKind, input.usageImpact);
            }),

        surveyOpen: procedure
            .input(
                z.object({
                    experienceKind: z.enum([ExperienceKind.Mongo, ExperienceKind.NoSQL]),
                    triggerAction: z.string(),
                }),
            )
            .mutation(({ input }: { input: { experienceKind: ExperienceKind; triggerAction: string } }) => {
                openSurvey(input.experienceKind, input.triggerAction);
            }),

        showInformationMessage: procedure
            .input(z.object({ message: z.string() }))
            .mutation(async ({ input }: { input: { message: string } }) => {
                await vscode.window.showInformationMessage(input.message);
            }),

        showErrorMessage: procedure
            .input(z.object({ message: z.string() }))
            .mutation(async ({ input }: { input: { message: string } }) => {
                await vscode.window.showErrorMessage(input.message);
            }),

        executeReportIssueCommand: procedure.mutation(async () => {
            await vscode.commands.executeCommand('azureDatabases.reportIssue');
        }),

        openUrl: procedure
            .input(z.object({ url: z.string() }))
            .mutation(async ({ input }: { input: { url: string } }) => {
                await vscode.env.openExternal(vscode.Uri.parse(input.url));
            }),
    });
}
/* oxlint-enable typescript/no-explicit-any, typescript/no-unsafe-call, typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-return */

// ─── Query Editor App Router

export const queryEditorAppRouter = queryEditorRouter({
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    common: buildCommonRouter(queryEditorProcedure, queryEditorRouter),
    queryEditor: queryEditorMergeRouters(queryEditorRouterDef, queryEditorEventsRouterDef),
});

export type QueryEditorAppRouter = typeof queryEditorAppRouter;
export { queryEditorCallerFactory };

// ─── Document App Router ────────────────────────────────────────────────────

export const documentAppRouter = documentRouter({
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    common: buildCommonRouter(documentProcedure, documentRouter),
    document: documentRouterDef,
});

export type DocumentAppRouter = typeof documentAppRouter;
export { documentCallerFactory };

// ─── Migration Assistant App Router ─────────────────────────────────────────

export const migrationAppRouter = migrationRouter({
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    common: buildCommonRouter(migrationProcedure, migrationRouter),
    migration: migrationMergeRouters(migrationRouterDef, migrationEventsRouterDef),
});

export type MigrationAppRouter = typeof migrationAppRouter;
export { migrationCallerFactory };

// ─── Account Overview App Router ────────────────────────────────────────────

export const accountOverviewAppRouter = accountOverviewRouter({
    // oxlint-disable-next-line typescript/no-unsafe-assignment
    common: buildCommonRouter(accountOverviewProcedure, accountOverviewRouter),
    accountOverview: accountOverviewRouterDef,
});

export type AccountOverviewAppRouter = typeof accountOverviewAppRouter;
export { accountOverviewCallerFactory };
