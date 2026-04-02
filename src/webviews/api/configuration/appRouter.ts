/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This a minimal tRPC server
 */
import { type PartitionKeyDefinition } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type TelemetryContext } from '../../../Telemetry';
import { type NoSqlQueryConnection } from '../../../cosmosdb/NoSqlQueryConnection';
import { type QuerySession } from '../../../cosmosdb/session/QuerySession';
import { type CosmosDBRecordIdentifier } from '../../../cosmosdb/types/queryResult';
import { type TypedEventSink } from '../../../utils/TypedEventSink';
import { openSurvey, promptAfterActionEventually } from '../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../utils/surveyTypes';
import { commonProcedure, mergeRouters, publicProcedure, router, trpcToTelemetry } from '../extension-server/trpc';
import { documentRouter } from './routers/documentRouter';
import { queryEditorEventsRouter, type QueryEditorEvent } from './routers/queryEditorEventsRouter';
import { queryEditorRouter } from './routers/queryEditorRouter';

/**
 * You can read more about tRPC here:
 * https://trpc.io/docs/quickstart
 *
 * This should be enough for you to catch up with this file.
 *
 * We're bundling routers here; each webview maintains its own router.
 * Here is where we bundle them all together.
 *
 * There is one router called 'commonRouter'. It has procedures that are shared across all webviews.
 */

export type BaseRouterContext = {
    webviewName: string;
    signal?: AbortSignal; // This is a special property that is used to cancel subscriptions
};

export type QueryEditorRouterContext = BaseRouterContext & {
    connection?: NoSqlQueryConnection;
    sessions: Map<string, QuerySession>;
    telemetryContext: TelemetryContext;
    panel: vscode.WebviewPanel;
    eventSink: TypedEventSink<QueryEditorEvent>;
    // Mutable state fields
    query?: string;
    isLastQueryAIGenerated: boolean;
    lastAIGeneratedQuery?: string;
    lastGenerationFailed: boolean;
    generateQueryCancellation?: vscode.CancellationTokenSource;
    pendingConfirmResolve?: (confirmed: boolean) => void;
    setConnection: (connection?: NoSqlQueryConnection) => void;
};

export type DocumentRouterContext = BaseRouterContext & {
    connection: NoSqlQueryConnection;
    telemetryContext: TelemetryContext;
    panel: vscode.WebviewPanel;
    // Mutable state fields
    mode: 'add' | 'edit' | 'view';
    documentId: CosmosDBRecordIdentifier | undefined;
    isDirty: boolean;
    partitionKeyDefinition?: PartitionKeyDefinition;
};

/**
 * eventName: string,
        properties?: Record<string, string>,
        measurements?: Record<string, number>
 */
const commonRouter = router({
    reportEvent: commonProcedure
        .input(
            z.object({
                eventName: z.string(),
                properties: z.optional(z.record(z.string(), z.string())),
                measurements: z.optional(z.record(z.string(), z.number())),
            }),
        )
        .mutation(({ input, ctx }) => {
            void callWithTelemetryAndErrorHandling<void>(
                `cosmosDB.NoSQL.webview.event.${ctx.webviewName}.${input.eventName}`,
                (context) => {
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.properties.experience = 'NoSQL';
                    Object.assign(context.telemetry.properties, input.properties ?? {});
                    Object.assign(context.telemetry.measurements, input.measurements ?? {});
                },
            );
        }),
    reportError: commonProcedure
        .input(
            z.object({
                message: z.string(),
                stack: z.string(),
                componentStack: z.optional(z.string()),
                properties: z.optional(z.record(z.string(), z.string())),
            }),
        )
        .mutation(({ input, ctx }) => {
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
        }),
    displayErrorMessage: commonProcedure
        .input(
            z.object({
                message: z.string(),
                modal: z.boolean(),
                cause: z.string(),
            }),
        )
        .mutation(({ input }) => {
            let message = input.message;
            if (input.cause && !input.modal) {
                message += ` (${input.cause})`;
            }

            void vscode.window.showErrorMessage(message, {
                modal: input.modal,
                detail: input.modal ? input.cause : undefined, // The content of the 'detail' field is only shown when modal is true
            });
        }),
    surveyPing: publicProcedure
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
        .mutation(({ input }) => {
            void promptAfterActionEventually(input.experienceKind, input.usageImpact);
        }),
    surveyOpen: publicProcedure
        .input(
            z.object({
                experienceKind: z.enum([ExperienceKind.Mongo, ExperienceKind.NoSQL]),
                triggerAction: z.string(),
            }),
        )
        .mutation(({ input }) => {
            void openSurvey(input.experienceKind, input.triggerAction);
        }),
    showInformationMessage: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ message: z.string() }))
        .mutation(async ({ input }) => {
            await vscode.window.showInformationMessage(input.message);
        }),
    showErrorMessage: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ message: z.string() }))
        .mutation(async ({ input }) => {
            await vscode.window.showErrorMessage(input.message);
        }),
    executeReportIssueCommand: publicProcedure.use(trpcToTelemetry).mutation(async () => {
        await vscode.commands.executeCommand('azureDatabases.reportIssue');
    }),
});

export const appRouter = router({
    common: commonRouter,
    queryEditor: mergeRouters(queryEditorRouter, queryEditorEventsRouter),
    document: documentRouter,
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;
