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
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type TelemetryContext } from '../../Telemetry';
import { type NoSqlQueryConnection } from '../../cosmosdb/NoSqlQueryConnection';
import { type QuerySession } from '../../cosmosdb/session/QuerySession';
import { type CosmosDBRecordIdentifier } from '../../cosmosdb/types/queryResult';
import { type TypedEventSink } from '../../utils/TypedEventSink';
import { openSurvey, promptAfterActionEventually } from '../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../utils/surveyTypes';
import { documentRouterDef } from './routers/documentRouter';
import { queryEditorEventsRouterDef, type QueryEditorEvent } from './routers/queryEditorEventsRouter';
import { queryEditorRouterDef } from './routers/queryEditorRouter';
import {
    documentCallerFactory,
    documentProcedure,
    documentRouter,
    queryEditorCallerFactory,
    queryEditorMergeRouters,
    queryEditorProcedure,
    queryEditorRouter,
} from './trpc';

// ─── Context Types ──────────────────────────────────────────────────────────

export type BaseRouterContext = {
    webviewName: string;
    signal?: AbortSignal;
    /**
     * Telemetry action context injected by the telemetry middleware.
     * Available in all procedures — use it to set custom telemetry properties
     * instead of wrapping handlers in `callWithTelemetryAndErrorHandling`.
     */
    actionContext?: IActionContext;
};

export type QueryEditorMutableState = {
    connection?: NoSqlQueryConnection;
    query?: string;
    isLastQueryAIGenerated: boolean;
    lastAIGeneratedQuery?: string;
    lastGenerationFailed: boolean;
    generateQueryCancellation?: vscode.CancellationTokenSource;
    pendingConfirmResolve?: (confirmed: boolean) => void;
};

export type QueryEditorRouterContext = BaseRouterContext & {
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

export type DocumentRouterContext = BaseRouterContext & {
    connection: NoSqlQueryConnection;
    telemetryContext: TelemetryContext;
    panel: vscode.WebviewPanel;
    state: DocumentMutableState;
};

// ─── Common Procedures (per-instance) ───────────────────────────────────────

/**
 * Builds common procedures using the given tRPC instance tools.
 * This is called once per tRPC instance so the procedures share the
 * instance's context type (QueryEditorRouterContext or DocumentRouterContext).
 *
 * Common procedures only access `ctx.webviewName` which is on BaseRouterContext,
 * so they work with any context that extends it.
 *
 * Telemetry middleware is already baked into each procedure, so individual
 * `.use(trpcToTelemetry)` calls are not needed here.
 */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCommonRouter(procedure: any, routerFn: any) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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
                    ctx: BaseRouterContext;
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
                    ctx: BaseRouterContext;
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
/* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment */

// ─── Query Editor App Router

export const queryEditorAppRouter = queryEditorRouter({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    common: buildCommonRouter(queryEditorProcedure, queryEditorRouter),
    queryEditor: queryEditorMergeRouters(queryEditorRouterDef, queryEditorEventsRouterDef),
});

export type QueryEditorAppRouter = typeof queryEditorAppRouter;
export { queryEditorCallerFactory };

// ─── Document App Router ────────────────────────────────────────────────────

export const documentAppRouter = documentRouter({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    common: buildCommonRouter(documentProcedure, documentRouter),
    document: documentRouterDef,
});

export type DocumentAppRouter = typeof documentAppRouter;
export { documentCallerFactory };
