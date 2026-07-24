/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition, type PriorityLevel } from '@azure/cosmos';
import { parse, parseMultiQueryDocument, stripComments } from '@cosmosdb/nosql-language-service';
import { type JSONSchema } from '@cosmosdb/schema-analyzer';
import { type NoSQLDocument } from '@cosmosdb/schema-analyzer/json';
import { callWithTelemetryAndErrorHandling, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { z } from 'zod';
import { CosmosDbOperationsService, QueryGenerationRefusedError } from '../../../chat';
import { getControlPlaneForConnection } from '../../../cosmosdb/controlPlane';
import { getNoSqlQueryConnection, type NoSqlQueryConnection } from '../../../cosmosdb/NoSqlQueryConnection';
import { bulkDeleteDocuments, deleteDocument, isDocumentId } from '../../../cosmosdb/session/DocumentSession';
import { QuerySession } from '../../../cosmosdb/session/QuerySession';
import { getEnabledThroughputBuckets } from '../../../cosmosdb/throughputBuckets';
import { withClaimsChallengeHandling } from '../../../cosmosdb/withClaimsChallengeHandling';
import { recordCosmosShellEngagementAndMaybeRecommend } from '../../../cosmosDBShell/recommendation/shellRecommendation';
import { ext } from '../../../extensionVariables';
import { SchemaFileStorage } from '../../../services/SchemaFileStorage';
import { SchemaService } from '../../../services/SchemaService';
import { StorageNames, StorageService, type StorageItem } from '../../../services/StorageService';
import { getAvailableModelsInfo, getSelectedModel } from '../../../utils/aiUtils';
import { queryMetricsToCsv, queryResultToCsv } from '../../../utils/csvConverter';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { isSelectStar } from '../../../utils/queryAnalysis';
import { commentOutQuery, sanitizeSqlComment } from '../../../utils/sanitization';
import { toStringUniversal } from '../../../utils/strings';
import { getIsSurveyDisabledGlobally, openSurvey, promptAfterActionEventually } from '../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../utils/surveyTypes';
import * as vscodeUtil from '../../../utils/vscodeUtils';
import { DocumentTab } from '../../DocumentTab';
import { QueryEditorTab } from '../../QueryEditorTab';
import { type QueryEditorRouterContext } from '../appRouter';
import {
    CosmosDBRecordIdentifierSchema,
    OpenDocumentModeSchema,
    PartitionKeyDefinitionSchema,
    QueryExecutionResultSchema,
    QueryMetadataSchema,
    SerializedQueryResultSchema,
} from '../schemas';
import { queryEditorProcedure, queryEditorRouter } from '../trpc';

const QUERY_HISTORY_SIZE = 10;
const HISTORY_STORAGE_KEY = 'ms-azuretools.vscode-cosmosdb.history';
const SELECTED_MODEL_KEY = 'ms-azuretools.vscode-cosmosdb.selectedModel';
// Persists the user-selected Priority Level across panel reopens. Single key
// scope (per-extension, not per-account / per-container) to mirror cosmos-explorer
// which stores one LocalStorage entry for all connections.
const PRIORITY_LEVEL_KEY = 'ms-azuretools.vscode-cosmosdb.priorityLevel';
const DEFAULT_PRIORITY_LEVEL: PriorityLevel = 'Low' as PriorityLevel;

/**
 * Read the persisted Priority Level from extension global state, validating it
 * against the known enum values. Falls back to `Low` (per PRD F3/F4) for unset
 * or corrupted entries.
 */
function readPersistedPriorityLevel(): PriorityLevel {
    const stored = ext.context.globalState.get<string>(PRIORITY_LEVEL_KEY);
    if (stored === 'High' || stored === 'Low') {
        return stored as PriorityLevel;
    }
    return DEFAULT_PRIORITY_LEVEL;
}

type HistoryItem = StorageItem & {
    properties: {
        history: string[];
    };
};

/**
 * Connection state returned by init and connection mutations.
 */
type ConnectionState = {
    dbName: string;
    containerName: string;
    partitionKey?: PartitionKeyDefinition;
};

// ─── Query Editor Router ────────────────────────────────────────────────────
//
// Telemetry is handled by the middleware — procedures use `ctx.actionContext`
// to set custom properties instead of wrapping in `callWithTelemetryAndErrorHandling`.
// Fire-and-forget telemetry calls with separate IDs (e.g. `cosmosDB.ai.*`) are kept as-is.

export const queryEditorRouterDef = queryEditorRouter({
    /**
     * Initializes the query editor webview with connection state, query history,
     * throughput buckets, initial query, survey status, and AI features status.
     */
    init: queryEditorProcedure.mutation(async ({ ctx }) => {
        console.debug(`[QueryEditor] init invoked. hasConnection=${!!ctx.state.connection}`);

        if (ctx.actionContext) {
            ctx.actionContext.telemetry.suppressIfSuccessful = true;
        }

        let connectionState: ConnectionState | undefined;

        if (ctx.state.connection) {
            try {
                connectionState = await resolveConnectionState(ctx);
            } catch (error) {
                // Fall through — connection may be stale. The outer procedure is already
                // wrapped in telemetry; recovering the UX here intentionally treats this
                // as a non-fatal condition. Surface the cause via the output channel
                // for diagnosis.
                ext.outputChannel.error(
                    l10n.t('Failed to resolve connection for query editor: {0}', toStringUniversal(error)),
                );
            }
        } else {
            ctx.panel.title = QueryEditorTab.title;
        }

        const queryHistory = await getQueryHistory(ctx);

        const config = vscode.workspace.getConfiguration('cosmosDB.queryEditor');
        const isSchemaBasedOnQueries = config.get<boolean>('generateSchemaBasedOnQueries', false);

        const containerSchema = ctx.state.connection ? await readSchemaForConnection(ctx.state.connection) : null;

        const throughputBuckets = await getEnabledThroughputBuckets(ctx.state.connection, ctx.actionContext);

        return {
            connectionState,
            queryHistory,
            throughputBuckets,
            initialQuery: ctx.state.query,
            isSurveyCandidate: !getIsSurveyDisabledGlobally(),
            isAIFeaturesEnabled: ext.isAIFeaturesEnabled ?? false,
            isSchemaBasedOnQueries,
            containerSchema: containerSchema as Record<string, unknown> | null,
        };
    }),

    /**
     * Creates a new query session and returns its executionId immediately.
     * The session is stored but not yet executed — call `runQuery` with the
     * returned `executionId` to actually run it.
     */
    createQuerySession: queryEditorProcedure
        .input(z.object({ query: z.string(), options: QueryMetadataSchema }))
        .output(z.object({ executionId: z.string() }).optional())
        .mutation(async ({ input, ctx }) => {
            // Strip trailing semicolons — they are multi-query separators
            // in the editor but CosmosDB server rejects them.
            input.query = input.query.trim().replace(/;\s*$/, '');

            ctx.state.query = input.query;

            const wasAIGenerated = ctx.state.isLastQueryAIGenerated;
            const wasModified =
                wasAIGenerated &&
                ctx.state.lastAIGeneratedQuery !== undefined &&
                input.query !== ctx.state.lastAIGeneratedQuery;
            ctx.state.isLastQueryAIGenerated = false;
            ctx.state.lastAIGeneratedQuery = undefined;

            if (!ctx.state.connection) {
                throw new Error(l10n.t('No connection'));
            }

            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.isAIGenerated = String(wasAIGenerated);
                if (wasAIGenerated) {
                    ctx.actionContext.telemetry.properties.isQueryModified = String(wasModified);
                }
            }

            if (input.options.sessionId) {
                const existingSession = ctx.sessions.get(input.options.sessionId);
                if (existingSession) {
                    const message =
                        l10n.t('All loaded data will be lost. The query will be executed again in new session.') +
                        '\n' +
                        l10n.t('Are you sure you want to continue?');
                    const continueItem: vscode.MessageItem = { title: l10n.t('Continue') };
                    const closeItem: vscode.MessageItem = { title: l10n.t('Close'), isCloseAffordance: true };
                    const choice = await vscode.window.showWarningMessage(
                        message,
                        { modal: true },
                        continueItem,
                        closeItem,
                    );

                    if (choice !== continueItem) {
                        return undefined;
                    }
                }
            }

            const session = new QuerySession(ctx.state.connection, input.query, input.options);
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.executionId = session.id;
            }

            ctx.sessions.forEach((existingSession: QuerySession) => existingSession.dispose());
            ctx.sessions.clear();
            ctx.sessions.set(session.id, session);

            return { executionId: session.id };
        }),

    runQuery: queryEditorProcedure
        .input(z.object({ executionId: z.string() }))
        .output(QueryExecutionResultSchema.optional())
        .mutation(async ({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.executionId = input.executionId;
            }
            if (!ctx.state.connection) {
                throw new Error(l10n.t('No connection'));
            }
            const session = ctx.sessions.get(input.executionId);
            if (!session) {
                throw new Error(
                    l10n.t('No session found for executionId: {executionId}', {
                        executionId: input.executionId,
                    }),
                );
            }
            const result = await session.run();
            // Merge results into stored schema if setting is enabled and query is SELECT *
            void mergeQueryResultsIntoSchema(result, ctx.state.connection);
            void promptAfterActionEventually(
                ExperienceKind.NoSQL,
                UsageImpact.High,
                'cosmosDB.nosql.queryEditor.runQuery',
            );
            void recordCosmosShellEngagementAndMaybeRecommend('runQuery');
            return result;
        }),

    stopQuery: queryEditorProcedure.input(z.object({ executionId: z.string() })).mutation(({ input, ctx }) => {
        let session: QuerySession | undefined;

        if (input.executionId) {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.executionId = input.executionId;
            }
            session = ctx.sessions.get(input.executionId);
        } else {
            // No specific executionId — stop the latest (only) active session
            const entries = [...ctx.sessions.entries()];
            if (entries.length > 0) {
                const [id, latest] = entries[entries.length - 1];
                if (ctx.actionContext) {
                    ctx.actionContext.telemetry.properties.executionId = id;
                }
                session = latest;
            }
        }

        if (!session) {
            // Session may not exist yet (e.g., cancel pressed while runQuery is still in-flight)
            // or was already stopped/disposed. Return gracefully.
            return undefined;
        }

        const result = session.stop();
        ctx.sessions.delete(session.id);
        return result;
    }),

    nextPage: queryEditorProcedure
        .input(z.object({ executionId: z.string() }))
        .output(QueryExecutionResultSchema.optional())
        .mutation(async ({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.executionId = input.executionId;
            }
            if (!ctx.state.connection) throw new Error(l10n.t('No connection'));
            const session = ctx.sessions.get(input.executionId);
            if (!session)
                throw new Error(
                    l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                );
            const result = await session.nextPage();
            // Merge results into stored schema if setting is enabled and query is SELECT *
            void mergeQueryResultsIntoSchema(result, ctx.state.connection);
            void promptAfterActionEventually(
                ExperienceKind.NoSQL,
                UsageImpact.Medium,
                'cosmosDB.nosql.queryEditor.nextPage',
            );
            return result;
        }),

    prevPage: queryEditorProcedure
        .input(z.object({ executionId: z.string() }))
        .output(QueryExecutionResultSchema.optional())
        .mutation(async ({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.executionId = input.executionId;
            }
            if (!ctx.state.connection) throw new Error(l10n.t('No connection'));
            const session = ctx.sessions.get(input.executionId);
            if (!session)
                throw new Error(
                    l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                );
            const result = await session.prevPage();
            void promptAfterActionEventually(
                ExperienceKind.NoSQL,
                UsageImpact.Medium,
                'cosmosDB.nosql.queryEditor.prevPage',
            );
            return result;
        }),

    firstPage: queryEditorProcedure
        .input(z.object({ executionId: z.string() }))
        .output(QueryExecutionResultSchema.optional())
        .mutation(async ({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.executionId = input.executionId;
            }
            if (!ctx.state.connection) throw new Error(l10n.t('No connection'));
            const session = ctx.sessions.get(input.executionId);
            if (!session)
                throw new Error(
                    l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                );
            const result = await session.firstPage();
            void promptAfterActionEventually(
                ExperienceKind.NoSQL,
                UsageImpact.Medium,
                'cosmosDB.nosql.queryEditor.firstPage',
            );
            return result;
        }),

    openFile: queryEditorProcedure.mutation(async () => {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: l10n.t('Select'),
            canSelectFiles: true,
            canSelectFolders: false,
            title: l10n.t('Select query'),
            filters: {
                'Query files': ['sql', 'nosql'],
                'Text files': ['txt'],
            },
        };

        const fileUri = await vscode.window.showOpenDialog(options);
        if (fileUri && fileUri[0]) {
            const document = await vscode.workspace.openTextDocument(fileUri[0]);
            return { query: document.getText() };
        }
        return undefined;
    }),

    saveFile: queryEditorProcedure
        .input(z.object({ text: z.string(), filename: z.string(), ext: z.string() }))
        .mutation(async ({ input }) => {
            let fileExt = input.ext;
            if (!fileExt.startsWith('.')) {
                fileExt = `.${fileExt}`;
            }
            await vscodeUtil.showNewFile(input.text, input.filename, fileExt);
        }),

    duplicateTab: queryEditorProcedure.input(z.object({ text: z.string() })).mutation(({ input, ctx }) => {
        QueryEditorTab.render(ctx.state.connection, ctx.panel.viewColumn, false, input.text);
    }),

    copyToClipboard: queryEditorProcedure.input(z.object({ text: z.string() })).mutation(async ({ input }) => {
        await vscode.env.clipboard.writeText(input.text);
    }),

    getConnections: queryEditorProcedure.query(async ({ ctx }) => {
        if (!ctx.state.connection) {
            return { connectionList: {} as Record<string, string[]> };
        }

        const controlPlane = getControlPlaneForConnection(ctx.state.connection);
        const databases = await controlPlane.listDatabases();

        const containers = await Promise.allSettled(
            databases.map(async (database) => {
                const dbContainers = await controlPlane.listContainers(database.id);
                return dbContainers.map((container) => [database.id, container.id] as string[]);
            }),
        );

        const errors = containers.filter((result) => result.status === 'rejected');
        const connections = containers
            .filter((result) => result.status === 'fulfilled')
            .reduce(
                (acc, databaseContainers) => {
                    databaseContainers.value.forEach(([databaseId, containerId]) => {
                        acc[databaseId] ??= [];
                        acc[databaseId].push(containerId);
                    });
                    return acc;
                },
                {} as Record<string, string[]>,
            );

        if (errors.length > 0) {
            const errorSummary = errors.map((error) => toStringUniversal(error.reason)).join(', ');
            ext.outputChannel.error(l10n.t('Failed to list containers for one or more databases: {0}', errorSummary));
        }

        return { connectionList: connections };
    }),

    setConnection: queryEditorProcedure
        .input(z.object({ databaseId: z.string(), containerId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            if (!input.databaseId || !input.containerId) {
                throw new Error(l10n.t('Invalid database or container id'));
            }
            if (!ctx.state.connection) {
                throw new Error(l10n.t('No connection to set'));
            }
            return resolveConnectionState(ctx, {
                ...ctx.state.connection,
                databaseId: input.databaseId,
                containerId: input.containerId,
            });
        }),

    connectToDatabase: queryEditorProcedure.mutation(async ({ ctx }) => {
        const connection = await getNoSqlQueryConnection();
        if (connection) {
            const { databaseId, containerId } = connection;
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.databaseId = crypto
                    .createHash('sha256')
                    .update(databaseId)
                    .digest('hex');
                ctx.actionContext.telemetry.properties.containerId = crypto
                    .createHash('sha256')
                    .update(containerId)
                    .digest('hex');
                ctx.actionContext.telemetry.properties.isEmulator = connection.isEmulator.toString();
            }
            return resolveConnectionState(ctx, connection);
        }
        return undefined;
    }),

    disconnectFromDatabase: queryEditorProcedure.mutation(({ ctx }) => {
        ctx.state.connection = undefined;
        ctx.panel.title = QueryEditorTab.title;
        return { disconnected: true } as const;
    }),

    openDocument: queryEditorProcedure
        .input(
            z.object({
                mode: OpenDocumentModeSchema,
                documentId: CosmosDBRecordIdentifierSchema.optional(),
            }),
        )
        .mutation(({ input, ctx }) => {
            if (!ctx.state.connection) throw new Error(l10n.t('No connection'));
            if (!input.documentId && input.mode !== 'add') {
                throw new Error(l10n.t('Impossible to open an item without an id'));
            }

            let viewColumn = ctx.panel.viewColumn ?? vscode.ViewColumn.Active;
            if (viewColumn === vscode.ViewColumn.Nine) {
                viewColumn = vscode.ViewColumn.One;
            } else {
                viewColumn += 1;
            }
            DocumentTab.render(ctx.state.connection, input.mode, input.documentId, viewColumn);
            void promptAfterActionEventually(
                ExperienceKind.NoSQL,
                UsageImpact.Medium,
                'cosmosDB.nosql.queryEditor.openDocument',
            );
        }),

    deleteDocument: queryEditorProcedure
        .input(z.object({ documentId: CosmosDBRecordIdentifierSchema }))
        .mutation(async ({ input, ctx }) => {
            if (!ctx.state.connection) throw new Error(l10n.t('No connection'));
            if (!input.documentId) throw new Error(l10n.t('Impossible to delete an item without an id'));

            const confirmation = await getConfirmationAsInSettings(
                l10n.t('Delete Confirmation'),
                l10n.t('Are you sure you want to delete the selected item?'),
                'delete',
            );

            if (!confirmation) {
                return { deleted: false } as const;
            }

            const deleted = await deleteDocument(ctx.state.connection, input.documentId);
            void promptAfterActionEventually(
                ExperienceKind.NoSQL,
                UsageImpact.Medium,
                'cosmosDB.nosql.queryEditor.deleteDocument',
            );
            return { deleted, documentId: input.documentId } as const;
        }),

    deleteDocuments: queryEditorProcedure
        .input(z.object({ documentIds: z.array(CosmosDBRecordIdentifierSchema) }))
        .mutation(async ({ input, ctx }) => {
            if (!ctx.state.connection) throw new Error(l10n.t('No connection'));

            const validCount = input.documentIds.filter((d) => isDocumentId(d)).length;
            const confirmation = await getConfirmationAsInSettings(
                validCount < 2 ? l10n.t('Delete Confirmation') : l10n.t('Bulk Delete Confirmation'),
                validCount < 2
                    ? l10n.t('Are you sure you want to delete the selected item?')
                    : l10n.t('Are you sure you want to delete selected items?'),
                'delete',
            );

            if (!confirmation) {
                return {
                    valid: [],
                    invalid: [],
                    deleted: [],
                    throttled: [],
                    failed: [],
                    aborted: true,
                };
            }

            const result = await bulkDeleteDocuments(ctx.state.connection, input.documentIds);
            void promptAfterActionEventually(
                ExperienceKind.NoSQL,
                UsageImpact.Medium,
                'cosmosDB.nosql.queryEditor.deleteDocuments',
            );
            return result;
        }),

    /**
     * Validates and cleans a query before execution.
     *
     * Performs two checks in order:
     * 1. **Ambiguity** — if the text contains multiple non-empty query regions
     *    (separated by `;`), the user is warned and can cancel or run anyway.
     * 2. **Syntax errors** — if the normalized query has parse errors, the user
     *    is shown a summary and can cancel or run anyway.
     *
     * Returns `{ cleanQuery }` on success, or `undefined` when the user cancels.
     * The returned `cleanQuery` is trimmed and has its trailing semicolon removed,
     * ready for `createQuerySession` and `updateQueryHistory`.
     */
    prepareQuery: queryEditorProcedure
        .input(z.object({ query: z.string() }))
        .output(z.object({ cleanQuery: z.string() }).optional())
        .mutation(async ({ input }) => {
            // Strip comments, normalize whitespace, then remove trailing semicolon
            const cleanQuery = stripComments(input.query).replace(/;\s*$/, '');

            if (!cleanQuery) return undefined;

            // Check 1: ambiguous multi-query text
            const doc = parseMultiQueryDocument(cleanQuery);
            const nonEmpty = doc.regions.filter((r) => r.text.trim().length > 0);
            if (nonEmpty.length > 1) {
                const runItem: vscode.MessageItem = { title: l10n.t('Run anyway') };
                const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
                const choice = await vscode.window.showWarningMessage(
                    l10n.t('The query text contains multiple statements separated by semicolons.') +
                        ' ' +
                        l10n.t('Running all of them at once may produce ambiguous results.'),
                    { modal: true },
                    runItem,
                    cancelItem,
                );
                if (choice !== runItem) return undefined;
            }

            // Check 2: syntax errors
            const { errors } = parse(cleanQuery);
            if (errors.length > 0) {
                const summary = errors
                    .slice(0, 3)
                    .map((e) => e.message)
                    .join('\n');
                const runItem: vscode.MessageItem = { title: l10n.t('Run anyway') };
                const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
                const choice = await vscode.window.showWarningMessage(
                    l10n.t('The query has syntax errors:') + '\n' + summary,
                    { modal: true },
                    runItem,
                    cancelItem,
                );
                if (choice !== runItem) return undefined;
            }

            return { cleanQuery };
        }),

    updateQueryHistory: queryEditorProcedure
        .input(z.object({ query: z.string().optional() }))
        .mutation(async ({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.suppressIfSuccessful = true;
            }
            if (!ctx.state.connection) throw new Error(l10n.t('No connection'));

            return { queryHistory: await persistQueryHistory(ctx, input.query) };
        }),

    updateQueryText: queryEditorProcedure.input(z.object({ query: z.string() })).mutation(({ input, ctx }) => {
        ctx.state.query = input.query;
    }),

    updateSelectedText: queryEditorProcedure
        .input(z.object({ selectedQuery: z.string() }))
        .mutation(({ input, ctx }) => {
            ctx.state.selectedQuery = input.selectedQuery || undefined;
        }),

    generateQuery: queryEditorProcedure
        .input(z.object({ prompt: z.string(), currentQuery: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const isRetry = ctx.state.lastGenerationFailed;
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.isRetry = String(isRetry);
            }
            ctx.state.lastGenerationFailed = false;

            ctx.state.generateQueryCancellation?.cancel();
            ctx.state.generateQueryCancellation?.dispose();
            ctx.state.generateQueryCancellation = new vscode.CancellationTokenSource();
            const token = ctx.state.generateQueryCancellation.token;

            try {
                const model = await getSelectedModel().catch(() => undefined);
                if (!model) {
                    throw new Error(l10n.t('No language models available. Please ensure you have access to Copilot.'));
                }

                if (token.isCancellationRequested) {
                    void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (telCtx) => {
                        telCtx.errorHandling.suppressDisplay = true;
                        telCtx.telemetry.properties.phase = 'beforeLLM';
                    });
                    return { generatedQuery: false as const };
                }

                const service = CosmosDbOperationsService.getInstance();

                const generatedQuery = await service.generateQueryWithLLM(input.prompt, input.currentQuery, {
                    modelId: model.id,
                    cancellationToken: token,
                    source: 'queryEditor',
                    operation: 'generateQuery',
                    connection: ctx.state.connection,
                    onConfirm: async (message: string) => {
                        ctx.eventSink.emit({ type: 'confirmToolInvocation', message });
                        return new Promise<boolean>((resolve) => {
                            ctx.state.pendingConfirmResolve = resolve;
                        });
                    },
                });

                if (token.isCancellationRequested) {
                    void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (telCtx) => {
                        telCtx.errorHandling.suppressDisplay = true;
                        telCtx.telemetry.properties.phase = 'afterLLM';
                    });
                    return { generatedQuery: false as const };
                }

                const sanitizedPrompt = sanitizeSqlComment(input.prompt);
                const sanitizedCurrentQuery = commentOutQuery(input.currentQuery);
                const finalQuery = `-- ${l10n.t('Generated from: {0}', sanitizedPrompt)}\n${generatedQuery.trim()}\n\n-- ${l10n.t('Previous query:')}\n${sanitizedCurrentQuery}`;

                ctx.state.isLastQueryAIGenerated = true;
                ctx.state.lastAIGeneratedQuery = finalQuery;

                void promptAfterActionEventually(
                    ExperienceKind.NoSQL,
                    UsageImpact.Medium,
                    'cosmosDB.nosql.queryEditor.generateQuery',
                );

                return {
                    generatedQuery: finalQuery,
                    modelName: model.name,
                    prompt: input.prompt,
                };
            } catch (error) {
                if (error instanceof QueryGenerationRefusedError) {
                    return {
                        generatedQuery: false as const,
                        errorMessage: error.message,
                    };
                }

                if (token.isCancellationRequested) {
                    void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (telCtx) => {
                        telCtx.errorHandling.suppressDisplay = true;
                        telCtx.telemetry.properties.phase = 'exception';
                    });
                    return { generatedQuery: false as const };
                }

                const errorMessage = parseError(error).message;
                ctx.state.lastGenerationFailed = true;
                void vscode.window.showErrorMessage(l10n.t('Failed to generate query: {0}', errorMessage));
                throw error;
            }
        }),

    cancelGenerateQuery: queryEditorProcedure.mutation(({ ctx }) => {
        ctx.state.pendingConfirmResolve?.(false);
        ctx.state.pendingConfirmResolve = undefined;
        if (ctx.state.generateQueryCancellation) {
            void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (telCtx) => {
                telCtx.errorHandling.suppressDisplay = true;
                telCtx.telemetry.properties.phase = 'userCancel';
            });
        }
        ctx.state.generateQueryCancellation?.cancel();
        ctx.state.generateQueryCancellation?.dispose();
        ctx.state.generateQueryCancellation = undefined;
    }),

    closeGenerateInput: queryEditorProcedure
        .input(z.object({ hadEnteredPrompt: z.boolean(), hadExecutedGenerateQuery: z.boolean() }).optional())
        .mutation(({ input, ctx }) => {
            ext.outputChannel.info(l10n.t('[Generate Query] Generate query input closed by user.'));
            void callWithTelemetryAndErrorHandling('cosmosDB.ai.closeGenerateInput', (telCtx) => {
                telCtx.errorHandling.suppressDisplay = true;
                if (input) {
                    telCtx.telemetry.properties.hadEnteredPrompt = String(input.hadEnteredPrompt);
                    telCtx.telemetry.properties.hadExecutedGenerateQuery = String(input.hadExecutedGenerateQuery);
                }
            });
            // Cancel any pending generation
            ctx.state.pendingConfirmResolve?.(false);
            ctx.state.pendingConfirmResolve = undefined;
            ctx.state.generateQueryCancellation?.cancel();
            ctx.state.generateQueryCancellation?.dispose();
            ctx.state.generateQueryCancellation = undefined;
        }),

    getSelectedModelName: queryEditorProcedure.query(async () => {
        try {
            const selectedModel = await getSelectedModel();
            return { modelName: selectedModel.name };
        } catch {
            return { modelName: 'Copilot' };
        }
    }),

    getAvailableModels: queryEditorProcedure.query(async () => {
        const { models, savedModelId } = await getAvailableModelsInfo();
        return {
            models: models.map((m) => ({ id: m.id, name: m.name, family: m.family, vendor: m.vendor })),
            savedModelId,
        };
    }),

    setSelectedModel: queryEditorProcedure.input(z.object({ modelId: z.string() })).mutation(async ({ input, ctx }) => {
        if (ctx.actionContext) {
            ctx.actionContext.errorHandling.suppressDisplay = true;
            ctx.actionContext.telemetry.properties.modelId = input.modelId;
        }

        await ext.context.globalState.update(SELECTED_MODEL_KEY, input.modelId);

        const selectedModel = await getSelectedModel({ modelId: input.modelId }).catch(() => undefined);
        return { modelName: selectedModel?.name ?? 'Copilot' };
    }),

    openChatParticipantExplainQuery: queryEditorProcedure
        .input(z.object({ query: z.string().optional() }).optional())
        .mutation(async ({ input }) => {
            const query = input?.query?.trim();
            const chatQuery = query
                ? `@cosmosdb /explainQuery\n\`\`\`sql\n${query}\n\`\`\``
                : '@cosmosdb /explainQuery';
            await vscode.commands.executeCommand('workbench.action.chat.open', { query: chatQuery });
        }),

    openChatParticipantHelp: queryEditorProcedure.mutation(async () => {
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: '@cosmosdb /help' });
    }),

    saveCSV: queryEditorProcedure
        .input(
            z.object({
                name: z.string(),
                result: SerializedQueryResultSchema.nullable(),
                partitionKey: PartitionKeyDefinitionSchema.optional(),
                selection: z.array(z.number()).optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const text = await queryResultToCsv(input.result, input.partitionKey, input.selection);
            await vscodeUtil.showNewFile(text, input.name, '.csv');
        }),

    saveMetricsCSV: queryEditorProcedure
        .input(z.object({ name: z.string(), result: SerializedQueryResultSchema.nullable() }))
        .mutation(async ({ input }) => {
            const text = await queryMetricsToCsv(input.result);
            await vscodeUtil.showNewFile(text, input.name, '.csv');
        }),

    copyCSVToClipboard: queryEditorProcedure
        .input(
            z.object({
                result: SerializedQueryResultSchema.nullable(),
                partitionKey: PartitionKeyDefinitionSchema.optional(),
                selection: z.array(z.number()).optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const text = await queryResultToCsv(input.result, input.partitionKey, input.selection);
            await vscode.env.clipboard.writeText(text);
        }),

    copyMetricsCSVToClipboard: queryEditorProcedure
        .input(z.object({ result: SerializedQueryResultSchema.nullable() }))
        .mutation(async ({ input }) => {
            const text = await queryMetricsToCsv(input.result);
            await vscode.env.clipboard.writeText(text);
        }),

    provideFeedback: queryEditorProcedure.mutation(() => {
        openSurvey(ExperienceKind.NoSQL, 'cosmosDB.nosql.queryEditor.provideFeedback');
    }),

    // ─── Schema Routes ──────────────────────────────────────────────────────

    generateSchema: queryEditorProcedure
        .input(z.object({ limit: z.number().optional() }))
        .mutation(async ({ input, ctx }) => {
            if (!ctx.state.connection) {
                throw new Error(l10n.t('No connection'));
            }

            if (ctx.actionContext && input.limit !== undefined) {
                ctx.actionContext.telemetry.properties.limit = input.limit.toString();
            }

            await SchemaService.getInstance().generateAndSaveSchema(ctx.state.connection, input.limit, {
                source: 'manualGenerate',
                actionContext: ctx.actionContext,
            });
        }),

    openSchemaSettings: queryEditorProcedure.mutation(async () => {
        const config = vscode.workspace.getConfiguration('cosmosDB.queryEditor');
        const current = config.get<boolean>('generateSchemaBasedOnQueries', false);
        await config.update('generateSchemaBasedOnQueries', !current, vscode.ConfigurationTarget.Global);
    }),

    showCurrentSchema: queryEditorProcedure.mutation(async ({ ctx }) => {
        if (!ctx.state.connection) {
            throw new Error(l10n.t('No connection'));
        }

        const containerLabel = `${ctx.state.connection.databaseId}/${ctx.state.connection.containerId}`;
        const metadata = SchemaService.getInstance().getMetadata(ctx.state.connection);

        if (!metadata) {
            void vscode.window.showInformationMessage(
                l10n.t('No schema found for {0}. Use the "Generate schema" option to create one.', containerLabel),
            );
            return;
        }

        const fileUri = SchemaFileStorage.getInstance().getSchemaFileUri(metadata.id);
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document, { preview: true });
    }),

    deleteCurrentSchema: queryEditorProcedure.mutation(async ({ ctx }) => {
        if (!ctx.state.connection) {
            throw new Error(l10n.t('No connection'));
        }

        await SchemaService.getInstance().deleteSchema(ctx.state.connection, {
            source: 'manualDelete',
            actionContext: ctx.actionContext,
        });
    }),

    reportFeedback: queryEditorProcedure
        .input(z.object({ feedbackValue: z.enum(['up', 'down']), component: z.string() }))
        .mutation(({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.feedbackDirection = input.feedbackValue;
                ctx.actionContext.telemetry.properties.category = input.component;
                ctx.actionContext.telemetry.properties.isAIGenerated = String(ctx.state.isLastQueryAIGenerated);
            }
            void vscode.window.showInformationMessage(l10n.t('Thanks for your feedback!'));
        }),

    confirmToolInvocationResponse: queryEditorProcedure
        .input(z.object({ confirmed: z.boolean() }))
        .mutation(({ input, ctx }) => {
            ctx.state.pendingConfirmResolve?.(input.confirmed);
            ctx.state.pendingConfirmResolve = undefined;
        }),

    /**
     * Returns query-editor capabilities that depend on the current connection.
     * Used by the webview to decide whether to show / enable connection-specific
     * UI such as Priority Level and Throughput Bucket controls.
     *
     * - `isEmulator`: true when the current connection points at the local emulator.
     *   Priority and Throughput options are meaningless against the emulator.
     * - `isPriorityLevelEnabled`: true when the Cosmos DB account has
     *   `enablePriorityBasedExecution` set on the ARM resource. Only available
     *   for Azure-signed-in accounts (where `azureMetadata` is populated);
     *   workspace-attached / connection-string accounts cannot read ARM and so
     *   never expose the UI.
     * - `currentPriorityLevel`: the priority level persisted in extension global
     *   state, falling back to `Low` for first use or invalid entries (PRD F3/F4).
     *   The UI uses this to seed the picker on panel open so the user's last
     *   choice survives reloads (PRD F2 / F10).
     */
    getCapabilities: queryEditorProcedure.mutation(({ ctx }) => {
        const databaseAccount = ctx.state.connection?.azureMetadata?.databaseAccount;

        return {
            isEmulator: ctx.state.connection?.isEmulator ?? false,
            isPriorityLevelEnabled: databaseAccount?.enablePriorityBasedExecution ?? false,
            currentPriorityLevel: readPersistedPriorityLevel(),
        };
    }),

    /**
     * Persists the user-selected Priority Level so it survives panel reopens
     * and Cosmos DB extension restarts. Mirrors cosmos-explorer's LocalStorage
     * model: one global value shared across all accounts / containers.
     */
    setPriorityLevel: queryEditorProcedure
        .input(z.object({ priorityLevel: z.enum(['High', 'Low']) }))
        .mutation(async ({ input }) => {
            await ext.context.globalState.update(PRIORITY_LEVEL_KEY, input.priorityLevel);
        }),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve connection state: sets the connection on the context, reads the
 * container definition, updates the panel title, and returns the state.
 */
async function resolveConnectionState(
    ctx: QueryEditorRouterContext,
    connection?: NoSqlQueryConnection,
): Promise<ConnectionState | undefined> {
    const conn = connection ?? ctx.state.connection;
    if (connection) {
        ctx.state.connection = connection;
    }

    if (!conn) return undefined;

    const { databaseId, containerId } = conn;
    const container = await withClaimsChallengeHandling(conn, async (client) =>
        client.database(databaseId).container(containerId).read(),
    );

    if (container.resource === undefined) {
        throw new Error(l10n.t('Container {0} not found', containerId));
    }

    ctx.panel.title = `${databaseId}/${containerId}`;

    return {
        dbName: databaseId,
        containerName: containerId,
        partitionKey: container.resource.partitionKey,
    };
}

/**
 * Get query history for the current connection (read-only).
 */
async function getQueryHistory(ctx: QueryEditorRouterContext): Promise<string[]> {
    if (!ctx.state.connection) return [];

    const storage = StorageService.get(StorageNames.Default);
    const containerId = `${ctx.state.connection.databaseId}/${ctx.state.connection.containerId}`;
    const historyItems = (await storage.getItems(HISTORY_STORAGE_KEY)) as HistoryItem[];
    const historyData = historyItems.find((item) => item.id === containerId);

    return historyData?.properties.history ?? [];
}

/**
 * Persist query history and return the updated list.
 */
async function persistQueryHistory(ctx: QueryEditorRouterContext, query?: string): Promise<string[]> {
    if (!ctx.state.connection) return [];

    const storage = StorageService.get(StorageNames.Default);
    const containerId = `${ctx.state.connection.databaseId}/${ctx.state.connection.containerId}`;
    const historyItems = (await storage.getItems(HISTORY_STORAGE_KEY)) as HistoryItem[];
    const historyData = historyItems.find((item) => item.id === containerId) ?? {
        id: containerId,
        name: containerId,
        properties: { history: [] as string[] },
    };

    const queryHistory = historyData.properties.history.filter((item) => item !== query);
    if (query) {
        queryHistory.unshift(query);
    }
    if (queryHistory.length > QUERY_HISTORY_SIZE) {
        queryHistory.length = QUERY_HISTORY_SIZE;
    }

    historyData.properties.history = queryHistory;
    await storage.push(HISTORY_STORAGE_KEY, historyData);

    return queryHistory;
}

/**
 * When the "Generate schema based on queries" setting is enabled and the query is
 * a SELECT *, merges the fetched documents into the stored schema for the current container.
 * Persistence + size guard + telemetry + webview notification all live in
 * `SchemaService` — subscribers receive the change via `onSchemaChanged`.
 */
async function mergeQueryResultsIntoSchema(
    queryResult: { result: { query: string; documents: unknown[] } | null } | undefined,
    connection: NoSqlQueryConnection,
): Promise<void> {
    if (!queryResult?.result) {
        return;
    }

    const config = vscode.workspace.getConfiguration('cosmosDB.queryEditor');
    const isEnabled = config.get<boolean>('generateSchemaBasedOnQueries', false);
    if (!isEnabled) {
        return;
    }

    if (!isSelectStar(queryResult.result.query ?? '')) {
        return;
    }

    const documents = queryResult.result.documents;
    if (!documents || documents.length === 0) {
        return;
    }

    try {
        await SchemaService.getInstance().mergeDocumentsIntoSchema(connection, documents as NoSQLDocument[], {
            source: 'queryMerge',
            suppressNotification: true,
            confirmAll: true,
            updateFromQueriesEnabled: true,
        });
    } catch (error) {
        ext.outputChannel.warn(
            l10n.t('[Schema] Failed to merge query results into schema: {0}', parseError(error).message),
        );
    }
}

/**
 * Read the stored schema for a connection, or return null if none exists.
 */
async function readSchemaForConnection(connection: NoSqlQueryConnection): Promise<JSONSchema | null> {
    return SchemaService.getInstance().readSchema(connection);
}
