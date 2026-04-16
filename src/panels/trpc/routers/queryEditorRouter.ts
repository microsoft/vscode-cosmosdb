/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { z } from 'zod';
import { CosmosDbOperationsService } from '../../../chat';
import { getCosmosClient } from '../../../cosmosdb/getCosmosClient';
import { getNoSqlQueryConnection, type NoSqlQueryConnection } from '../../../cosmosdb/NoSqlQueryConnection';
import { bulkDeleteDocuments, deleteDocument, isDocumentId } from '../../../cosmosdb/session/DocumentSession';
import { QuerySession } from '../../../cosmosdb/session/QuerySession';
import { withClaimsChallengeHandling } from '../../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../../extensionVariables';
import { DocumentTab } from '../../../panels/DocumentTab';
import { QueryEditorTab } from '../../../panels/QueryEditorTab';
import { SchemaFileStorage } from '../../../services/SchemaFileStorage';
import { StorageNames, StorageService, type StorageItem } from '../../../services/StorageService';
import { isSelectStar, toStringUniversal } from '../../../utils/convertors';
import { queryMetricsToCsv, queryResultToCsv } from '../../../utils/csvConverter';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { type JSONSchema } from '../../../utils/json/JSONSchema';
import {
    getSchemaFromDocument,
    simplifySchema,
    updateSchemaWithDocument,
    type NoSQLDocument,
} from '../../../utils/json/nosql/SchemaAnalyzer';
import { sanitizeSqlComment } from '../../../utils/sanitization';
import { getIsSurveyDisabledGlobally, openSurvey, promptAfterActionEventually } from '../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../utils/surveyTypes';
import * as vscodeUtil from '../../../utils/vscodeUtils';
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
const MAX_SCHEMA_DOCUMENT_LIMIT = 100_000;
const SCHEMA_SIZE_WARNING_BYTES = 50 * 1024 * 1024; // 50 MB
const SCHEMA_GENERATION_PAGE_SIZE = 1000;

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
        if (ctx.actionContext) {
            ctx.actionContext.telemetry.suppressIfSuccessful = true;
        }

        let connectionState: ConnectionState | undefined;

        if (ctx.state.connection) {
            try {
                connectionState = await resolveConnectionState(ctx);
            } catch {
                // Fall through — connection may be stale
            }
        } else {
            ctx.panel.title = QueryEditorTab.title;
        }

        const queryHistory = await getQueryHistory(ctx);

        const config = vscode.workspace.getConfiguration('cosmosDB.queryEditor');
        const isSchemaBasedOnQueries = config.get<boolean>('generateSchemaBasedOnQueries', false);

        const containerSchema = ctx.state.connection ? await readSchemaForConnection(ctx.state.connection) : null;

        return {
            connectionState,
            queryHistory,
            throughputBuckets: ctx.state.connection ? [true, true, true, true, true] : undefined,
            initialQuery: ctx.state.query,
            isSurveyCandidate: !getIsSurveyDisabledGlobally(),
            isAIFeaturesEnabled: ext.isAIFeaturesEnabled,
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
            void mergeQueryResultsIntoSchema(result, ctx.state.connection!, ctx.eventSink);
            void promptAfterActionEventually(
                ExperienceKind.NoSQL,
                UsageImpact.High,
                'cosmosDB.nosql.queryEditor.runQuery',
            );
            return result;
        }),

    stopQuery: queryEditorProcedure.input(z.object({ executionId: z.string() })).mutation(async ({ input, ctx }) => {
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
            void mergeQueryResultsIntoSchema(result, ctx.state.connection!, ctx.eventSink);
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
            return { connectionList: undefined };
        }

        const cosmosClient = getCosmosClient(ctx.state.connection);
        const databases = await cosmosClient.databases.readAll().fetchAll();
        const containers = await Promise.allSettled(
            databases.resources.map(async (database) => {
                const dbContainers = await cosmosClient.database(database.id).containers.readAll().fetchAll();
                return dbContainers.resources.map((container) => [database.id, container.id] as string[]);
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

        if (errors.length > 0 && ctx.actionContext) {
            ctx.actionContext.telemetry.properties.error = errors
                .map((error) => toStringUniversal(error.reason))
                .join(', ');
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

    updateQueryHistory: queryEditorProcedure
        .input(z.object({ query: z.string().optional() }))
        .mutation(async ({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.suppressIfSuccessful = true;
            }
            if (!ctx.state.connection) throw new Error(l10n.t('No connection'));

            return { queryHistory: await persistQueryHistory(ctx, input.query) };
        }),

    updateQueryText: queryEditorProcedure.input(z.object({ query: z.string() })).mutation(async ({ input, ctx }) => {
        ctx.state.query = input.query;
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
                const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
                if (models.length === 0) {
                    throw new Error(l10n.t('No language models available. Please ensure you have access to Copilot.'));
                }

                if (token.isCancellationRequested) {
                    void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (telCtx) => {
                        telCtx.errorHandling.suppressDisplay = true;
                        telCtx.telemetry.properties.phase = 'beforeLLM';
                    });
                    return { generatedQuery: false as const };
                }

                const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);
                const model = savedModelId ? (models.find((m) => m.id === savedModelId) ?? models[0]) : models[0];

                const service = CosmosDbOperationsService.getInstance();
                const historyContext = ctx.state.connection
                    ? service.getQueryHistoryForContainer(
                          ctx.state.connection.accountId,
                          ctx.state.connection.databaseId,
                          ctx.state.connection.containerId,
                      )
                    : undefined;

                const generatedQuery = await service.generateQueryWithLLM(input.prompt, input.currentQuery, {
                    modelId: model.id,
                    historyContext,
                    cancellationToken: token,
                    source: 'queryEditor',
                    operation: 'generateQuery',
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
                const sanitizedCurrentQuery = input.currentQuery
                    .split('\n')
                    .map((line) => sanitizeSqlComment(line))
                    .join('\n-- ');
                const finalQuery = `-- Generated from: ${sanitizedPrompt}\n${generatedQuery.trim()}\n\n-- Previous query:\n-- ${sanitizedCurrentQuery}`;

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

    cancelGenerateQuery: queryEditorProcedure.mutation(async ({ ctx }) => {
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

    closeGenerateInput: queryEditorProcedure.mutation(async ({ ctx }) => {
        ext.outputChannel.info('[Generate Query] Generate query input closed by user.');
        void callWithTelemetryAndErrorHandling('cosmosDB.ai.closeGenerateInput', (telCtx) => {
            telCtx.errorHandling.suppressDisplay = true;
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
            const models = await vscode.lm.selectChatModels();
            const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);
            const selectedModel = savedModelId ? (models.find((m) => m.id === savedModelId) ?? models[0]) : models[0];
            return { modelName: selectedModel?.name ?? 'Copilot' };
        } catch {
            return { modelName: 'Copilot' };
        }
    }),

    getAvailableModels: queryEditorProcedure.query(async () => {
        try {
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);

            const modelList = models
                .filter((m) => m.name.toLowerCase() !== 'auto')
                .map((m) => ({ id: m.id, name: m.name, family: m.family, vendor: m.vendor }));

            return { models: modelList, savedModelId: savedModelId ?? null };
        } catch {
            return { models: [], savedModelId: null };
        }
    }),

    setSelectedModel: queryEditorProcedure.input(z.object({ modelId: z.string() })).mutation(async ({ input }) => {
        await ext.context.globalState.update(SELECTED_MODEL_KEY, input.modelId);

        // Fire-and-forget: separate telemetry event for model selection
        void callWithTelemetryAndErrorHandling('cosmosDB.ai.modelSelection', (telCtx) => {
            telCtx.errorHandling.suppressDisplay = true;
            telCtx.telemetry.properties.modelId = input.modelId;
        });

        const models = await vscode.lm.selectChatModels();
        const selectedModel = models.find((m) => m.id === input.modelId);
        return { modelName: selectedModel?.name ?? 'Copilot' };
    }),

    openCopilotExplainQuery: queryEditorProcedure.mutation(async ({ ctx }) => {
        // Fire-and-forget: separate telemetry event
        void callWithTelemetryAndErrorHandling('cosmosDB.ai.explainQueryFromButton', (telCtx) => {
            telCtx.errorHandling.suppressDisplay = true;
        });

        const query = ctx.state.query?.trim();
        const chatQuery = query ? `@cosmosdb /explainQuery\n\`\`\`sql\n${query}\n\`\`\`` : '@cosmosdb /explainQuery';
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: chatQuery });
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

    provideFeedback: queryEditorProcedure.mutation(async () => {
        openSurvey(ExperienceKind.NoSQL, 'cosmosDB.nosql.queryEditor.provideFeedback');
    }),

    // ─── Schema Routes ──────────────────────────────────────────────────────

    generateSchema: queryEditorProcedure
        .input(z.object({ limit: z.number().optional() }))
        .mutation(async ({ input, ctx }) => {
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.generateSchema', async (context) => {
                if (!ctx.state.connection) {
                    throw new Error(l10n.t('No connection'));
                }

                const effectiveLimit =
                    input.limit === undefined
                        ? MAX_SCHEMA_DOCUMENT_LIMIT
                        : Math.min(input.limit, MAX_SCHEMA_DOCUMENT_LIMIT);

                context.telemetry.properties.limit = effectiveLimit.toString();

                const schemaId = getSchemaStorageId(ctx.state.connection);
                const containerLabel = `${ctx.state.connection.databaseId}/${ctx.state.connection.containerId}`;
                const limitLabel = input.limit
                    ? l10n.t('TOP {0}', effectiveLimit)
                    : l10n.t('ALL (up to {0})', MAX_SCHEMA_DOCUMENT_LIMIT);

                const schemaStorage = SchemaFileStorage.getInstance();
                const hasExistingSchema = schemaStorage.hasSchema(schemaId);

                const warningParts: string[] = [
                    l10n.t(
                        'Generating schema from {0} documents will execute a query against your Azure Cosmos DB container, which consumes Request Units (RUs).',
                        limitLabel,
                    ),
                ];

                if (hasExistingSchema) {
                    warningParts.push(l10n.t('The previously saved schema for this container will be replaced.'));
                }

                warningParts.push(l10n.t('Are you sure you want to continue?'));

                const message = warningParts.join('\n');

                const continueItem: vscode.MessageItem = { title: l10n.t('Continue') };
                const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
                const choice = await vscode.window.showWarningMessage(
                    message,
                    { modal: true },
                    continueItem,
                    cancelItem,
                );

                if (choice !== continueItem) {
                    return;
                }

                const connection = ctx.state.connection;
                const query =
                    effectiveLimit < MAX_SCHEMA_DOCUMENT_LIMIT
                        ? `SELECT TOP ${effectiveLimit} * FROM c`
                        : `SELECT * FROM c`;

                const result = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: l10n.t('Generating schema for {0}', containerLabel),
                        cancellable: true,
                    },
                    async (progress, token) => {
                        const iterator = await withClaimsChallengeHandling(connection, (client) =>
                            Promise.resolve(
                                client
                                    .database(connection.databaseId)
                                    .container(connection.containerId)
                                    .items.query(query, { maxItemCount: SCHEMA_GENERATION_PAGE_SIZE }),
                            ),
                        );

                        let schema: JSONSchema = {};
                        let totalDocCount = 0;
                        let isFirstDoc = true;

                        while (iterator.hasMoreResults() && totalDocCount < effectiveLimit) {
                            if (token.isCancellationRequested) {
                                break;
                            }

                            const page = await iterator.fetchNext();
                            const documents = page.resources ?? [];

                            if (documents.length === 0) {
                                break;
                            }

                            for (const doc of documents) {
                                if (totalDocCount >= effectiveLimit) {
                                    break;
                                }

                                if (isFirstDoc) {
                                    schema = getSchemaFromDocument(doc as NoSQLDocument);
                                    isFirstDoc = false;
                                } else {
                                    updateSchemaWithDocument(schema, doc as NoSQLDocument);
                                }
                                totalDocCount++;
                            }

                            const percentage = effectiveLimit
                                ? Math.round((totalDocCount / effectiveLimit) * 100)
                                : undefined;
                            progress.report({
                                message: l10n.t('{0} documents processed', totalDocCount),
                                increment:
                                    percentage !== undefined ? (documents.length / effectiveLimit) * 100 : undefined,
                            });
                        }

                        return { schema, totalDocCount, cancelled: token.isCancellationRequested };
                    },
                );

                const { schema, totalDocCount, cancelled } = result;

                if (totalDocCount === 0) {
                    void vscode.window.showInformationMessage(
                        l10n.t('No documents found in the container. Schema was not generated.'),
                    );
                    return;
                }

                simplifySchema(schema);

                const schemaJson = JSON.stringify(schema);
                const schemaSizeBytes = Buffer.byteLength(schemaJson, 'utf8');

                if (schemaSizeBytes > SCHEMA_SIZE_WARNING_BYTES) {
                    const sizeMB = (schemaSizeBytes / (1024 * 1024)).toFixed(1);
                    const proceed: vscode.MessageItem = { title: l10n.t('Save anyway') };
                    const discard: vscode.MessageItem = { title: l10n.t('Discard'), isCloseAffordance: true };
                    const sizeChoice = await vscode.window.showWarningMessage(
                        l10n.t(
                            'The generated schema is {0} MB, which is very large and may impact performance. Do you want to save it?',
                            sizeMB,
                        ),
                        { modal: true },
                        proceed,
                        discard,
                    );

                    if (sizeChoice !== proceed) {
                        return;
                    }
                }

                await schemaStorage.saveSchema(
                    schemaId,
                    containerLabel,
                    schemaJson,
                    new Date().toISOString(),
                    totalDocCount.toString(),
                );

                if (cancelled) {
                    void vscode.window.showInformationMessage(
                        l10n.t(
                            'Schema generation was cancelled. Partial schema from {0} documents has been saved for {1}.',
                            totalDocCount,
                            containerLabel,
                        ),
                    );
                } else {
                    void vscode.window.showInformationMessage(
                        l10n.t('Schema generated from {0} documents and saved for {1}.', totalDocCount, containerLabel),
                    );
                }

                // Push updated schema to webview
                const updatedSchema = await readSchemaForConnection(ctx.state.connection);
                ctx.eventSink.emit({
                    type: 'schemaUpdated',
                    containerSchema: updatedSchema as Record<string, unknown> | null,
                });
            });
        }),

    openSchemaSettings: queryEditorProcedure.mutation(async () => {
        const config = vscode.workspace.getConfiguration('cosmosDB.queryEditor');
        const current = config.get<boolean>('generateSchemaBasedOnQueries', false);
        await config.update('generateSchemaBasedOnQueries', !current, vscode.ConfigurationTarget.Global);
    }),

    showCurrentSchema: queryEditorProcedure.mutation(async ({ ctx }) => {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.showCurrentSchema', async () => {
            if (!ctx.state.connection) {
                throw new Error(l10n.t('No connection'));
            }

            const schemaId = getSchemaStorageId(ctx.state.connection);
            const containerLabel = `${ctx.state.connection.databaseId}/${ctx.state.connection.containerId}`;
            const schemaStorage = SchemaFileStorage.getInstance();

            if (!schemaStorage.hasSchema(schemaId)) {
                void vscode.window.showInformationMessage(
                    l10n.t('No schema found for {0}. Use the "Generate schema" option to create one.', containerLabel),
                );
                return;
            }

            const fileUri = schemaStorage.getSchemaFileUri(schemaId);
            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document, { preview: true });
        });
    }),

    deleteCurrentSchema: queryEditorProcedure.mutation(async ({ ctx }) => {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.deleteCurrentSchema', async () => {
            if (!ctx.state.connection) {
                throw new Error(l10n.t('No connection'));
            }

            const schemaId = getSchemaStorageId(ctx.state.connection);
            const containerLabel = `${ctx.state.connection.databaseId}/${ctx.state.connection.containerId}`;
            const schemaStorage = SchemaFileStorage.getInstance();

            if (!schemaStorage.hasSchema(schemaId)) {
                void vscode.window.showInformationMessage(l10n.t('No schema found for {0}.', containerLabel));
                return;
            }

            const deleteItem: vscode.MessageItem = { title: l10n.t('Delete') };
            const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
            const choice = await vscode.window.showWarningMessage(
                l10n.t(
                    'Are you sure you want to delete the schema for {0}? The schema file will be permanently removed from disk. To get the schema back, you will need to generate it again.',
                    containerLabel,
                ),
                { modal: true },
                deleteItem,
                cancelItem,
            );

            if (choice !== deleteItem) {
                return;
            }

            await schemaStorage.deleteSchema(schemaId);

            void vscode.window.showInformationMessage(l10n.t('Schema for {0} has been deleted.', containerLabel));

            // Push null schema to webview
            ctx.eventSink.emit({ type: 'schemaUpdated', containerSchema: null });
        });
    }),

    reportFeedback: queryEditorProcedure
        .input(z.object({ feedbackValue: z.enum(['up', 'down']), component: z.string() }))
        .mutation(({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.properties.feedback = input.feedbackValue;
                ctx.actionContext.telemetry.properties.category = input.component;
                ctx.actionContext.telemetry.properties.isAIGenerated = String(ctx.state.isLastQueryAIGenerated);
            }
        }),

    confirmToolInvocationResponse: queryEditorProcedure
        .input(z.object({ confirmed: z.boolean() }))
        .mutation(async ({ input, ctx }) => {
            ctx.state.pendingConfirmResolve?.(input.confirmed);
            ctx.state.pendingConfirmResolve = undefined;
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
 * If no schema exists yet, creates one from scratch.
 */
async function mergeQueryResultsIntoSchema(
    queryResult: { result: { query: string; documents: unknown[] } | null } | undefined,
    connection: NoSqlQueryConnection,
    eventSink: QueryEditorRouterContext['eventSink'],
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

    const schemaId = getSchemaStorageId(connection);
    const containerLabel = `${connection.databaseId}/${connection.containerId}`;
    const schemaStorage = SchemaFileStorage.getInstance();

    // Load existing schema or start fresh
    const existingMetadata = schemaStorage.getMetadata(schemaId);
    const existingSchemaJson = existingMetadata ? await schemaStorage.readSchema(schemaId) : undefined;

    let schema: JSONSchema;
    let totalDocCount: number;

    if (existingSchemaJson) {
        schema = JSON.parse(existingSchemaJson) as JSONSchema;
        totalDocCount = parseInt(existingMetadata!.documentCount, 10) || 0;
    } else {
        schema = {};
        totalDocCount = 0;
    }

    // Merge each document into the schema
    for (const doc of documents) {
        if (totalDocCount === 0 && Object.keys(schema).length === 0) {
            schema = getSchemaFromDocument(doc as NoSQLDocument);
        } else {
            updateSchemaWithDocument(schema, doc as NoSQLDocument);
        }
        totalDocCount++;
    }
    simplifySchema(schema);

    await schemaStorage.saveSchema(
        schemaId,
        containerLabel,
        JSON.stringify(schema),
        new Date().toISOString(),
        totalDocCount.toString(),
    );

    // Push updated schema to webview
    const updatedSchema = await readSchemaForConnection(connection);
    eventSink.emit({
        type: 'schemaUpdated',
        containerSchema: updatedSchema as Record<string, unknown> | null,
    });
}

/**
 * Get the schema storage ID for a given connection.
 */
function getSchemaStorageId(connection: NoSqlQueryConnection): string {
    const raw = `${connection.endpoint}/${connection.databaseId}/${connection.containerId}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Read the stored schema for a connection, or return null if none exists.
 */
async function readSchemaForConnection(connection: NoSqlQueryConnection): Promise<JSONSchema | null> {
    const schemaId = getSchemaStorageId(connection);
    const schemaStorage = SchemaFileStorage.getInstance();
    const schemaJson = await schemaStorage.readSchema(schemaId);
    return schemaJson ? (JSON.parse(schemaJson) as JSONSchema) : null;
}
