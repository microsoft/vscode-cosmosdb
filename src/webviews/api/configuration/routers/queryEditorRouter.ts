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
import { CosmosDbOperationsService } from '../../../../chat';
import { getCosmosClient } from '../../../../cosmosdb/getCosmosClient';
import { getNoSqlQueryConnection, type NoSqlQueryConnection } from '../../../../cosmosdb/NoSqlQueryConnection';
import { bulkDeleteDocuments, deleteDocument, isDocumentId } from '../../../../cosmosdb/session/DocumentSession';
import { QuerySession } from '../../../../cosmosdb/session/QuerySession';
import { withClaimsChallengeHandling } from '../../../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../../../extensionVariables';
import { DocumentTab } from '../../../../panels/DocumentTab';
import { QueryEditorTab } from '../../../../panels/QueryEditorTab';
import { StorageNames, StorageService, type StorageItem } from '../../../../services/StorageService';
import { toStringUniversal } from '../../../../utils/convertors';
import { queryMetricsToCsv, queryResultToCsv } from '../../../../utils/csvConverter';
import { getConfirmationAsInSettings } from '../../../../utils/dialogs/getConfirmation';
import { sanitizeSqlComment } from '../../../../utils/sanitization';
import { getIsSurveyDisabledGlobally, openSurvey, promptAfterActionEventually } from '../../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../../utils/surveyTypes';
import * as vscodeUtil from '../../../../utils/vscodeUtils';
import { queryEditorProcedure, router, trpcToTelemetry } from '../../extension-server/trpc';
import { type QueryEditorRouterContext } from '../appRouter';
import {
    CosmosDBRecordIdentifierSchema,
    OpenDocumentModeSchema,
    PartitionKeyDefinitionSchema,
    QueryExecutionResultSchema,
    QueryMetadataSchema,
    SerializedQueryResultSchema,
} from '../schemas';

const QUERY_HISTORY_SIZE = 10;
const HISTORY_STORAGE_KEY = 'ms-azuretools.vscode-cosmosdb.history';
const SELECTED_MODEL_KEY = 'ms-azuretools.vscode-cosmosdb.selectedModel';

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

export const queryEditorRouter = router({
    /**
     * Initializes the query editor webview with connection state, query history,
     * throughput buckets, initial query, survey status, and AI features status.
     */
    init: queryEditorProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        return (
            callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.init', async (context) => {
                context.telemetry.suppressIfSuccessful = true;

                let connectionState: ConnectionState | undefined;

                if (ctx.connection) {
                    try {
                        connectionState = await resolveConnectionState(ctx);
                    } catch {
                        // Fall through — connection may be stale
                    }
                } else {
                    ctx.panel.title = QueryEditorTab.title;
                }

                const queryHistory = await getQueryHistory(ctx);

                return {
                    connectionState,
                    queryHistory,
                    throughputBuckets: ctx.connection ? [true, true, true, true, true] : undefined,
                    initialQuery: ctx.query,
                    isSurveyCandidate: !getIsSurveyDisabledGlobally(),
                    isAIFeaturesEnabled: ext.isAIFeaturesEnabled,
                };
            }) ?? {
                queryHistory: [],
                isSurveyCandidate: false,
                isAIFeaturesEnabled: false,
            }
        );
    }),

    runQuery: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ query: z.string(), options: QueryMetadataSchema }))
        .output(QueryExecutionResultSchema.optional())
        .mutation(async ({ input, ctx }) => {
            ctx.query = input.query;

            const wasAIGenerated = ctx.isLastQueryAIGenerated;
            const wasModified =
                wasAIGenerated && ctx.lastAIGeneratedQuery !== undefined && input.query !== ctx.lastAIGeneratedQuery;
            ctx.isLastQueryAIGenerated = false;
            ctx.lastAIGeneratedQuery = undefined;

            const callbackId = 'cosmosDB.nosql.queryEditor.runQuery';
            const execResult = await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                if (!ctx.connection) {
                    throw new Error(l10n.t('No connection'));
                }

                context.telemetry.properties.isAIGenerated = String(wasAIGenerated);
                if (wasAIGenerated) {
                    context.telemetry.properties.isQueryModified = String(wasModified);
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

                const session = new QuerySession(ctx.connection, input.query, input.options);
                context.telemetry.properties.executionId = session.id;

                ctx.sessions.forEach((existingSession) => existingSession.dispose());
                ctx.sessions.clear();
                ctx.sessions.set(session.id, session);

                return session.run();
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.High, callbackId);
            return execResult ?? undefined;
        }),

    stopQuery: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ executionId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            return callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.stopQuery', async (context) => {
                context.telemetry.properties.executionId = input.executionId;
                const session = ctx.sessions.get(input.executionId);
                if (!session) {
                    throw new Error(
                        l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                    );
                }
                const result = session.stop();
                ctx.sessions.delete(input.executionId);
                return result;
            });
        }),

    nextPage: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ executionId: z.string() }))
        .output(QueryExecutionResultSchema.optional())
        .mutation(async ({ input, ctx }) => {
            const callbackId = 'cosmosDB.nosql.queryEditor.nextPage';
            const execResult = await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                context.telemetry.properties.executionId = input.executionId;
                if (!ctx.connection) throw new Error(l10n.t('No connection'));
                const session = ctx.sessions.get(input.executionId);
                if (!session)
                    throw new Error(
                        l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                    );
                return session.nextPage();
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
            return execResult ?? undefined;
        }),

    prevPage: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ executionId: z.string() }))
        .output(QueryExecutionResultSchema.optional())
        .mutation(async ({ input, ctx }) => {
            const callbackId = 'cosmosDB.nosql.queryEditor.prevPage';
            const execResult = await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                context.telemetry.properties.executionId = input.executionId;
                if (!ctx.connection) throw new Error(l10n.t('No connection'));
                const session = ctx.sessions.get(input.executionId);
                if (!session)
                    throw new Error(
                        l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                    );
                return session.prevPage();
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
            return execResult ?? undefined;
        }),

    firstPage: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ executionId: z.string() }))
        .output(QueryExecutionResultSchema.optional())
        .mutation(async ({ input, ctx }) => {
            const callbackId = 'cosmosDB.nosql.queryEditor.firstPage';
            const execResult = await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                context.telemetry.properties.executionId = input.executionId;
                if (!ctx.connection) throw new Error(l10n.t('No connection'));
                const session = ctx.sessions.get(input.executionId);
                if (!session)
                    throw new Error(
                        l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                    );
                return session.firstPage();
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
            return execResult ?? undefined;
        }),

    openFile: queryEditorProcedure.use(trpcToTelemetry).mutation(async () => {
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

        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.openFile', async () => {
            const fileUri = await vscode.window.showOpenDialog(options);
            if (fileUri && fileUri[0]) {
                const document = await vscode.workspace.openTextDocument(fileUri[0]);
                return { query: document.getText() };
            }
            return undefined;
        });
    }),

    saveFile: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ text: z.string(), filename: z.string(), ext: z.string() }))
        .mutation(async ({ input }) => {
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.saveFile', async () => {
                let fileExt = input.ext;
                if (!fileExt.startsWith('.')) {
                    fileExt = `.${fileExt}`;
                }
                await vscodeUtil.showNewFile(input.text, input.filename, fileExt);
            });
        }),

    duplicateTab: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ text: z.string() }))
        .mutation(async ({ input, ctx }) => {
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.duplicateTab', () => {
                // Import dynamically to avoid circular dependency

                QueryEditorTab.render(ctx.connection, ctx.panel.viewColumn, false, input.text);
            });
        }),

    copyToClipboard: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ text: z.string() }))
        .mutation(async ({ input }) => {
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.copyToClipboard', async () => {
                await vscode.env.clipboard.writeText(input.text);
            });
        }),

    getConnections: queryEditorProcedure.use(trpcToTelemetry).query(async ({ ctx }) => {
        return (
            callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.getConnections', async (context) => {
                if (!ctx.connection) {
                    return { connectionList: undefined };
                }

                const cosmosClient = getCosmosClient(ctx.connection);
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

                if (errors.length > 0) {
                    context.telemetry.properties.error = errors
                        .map((error) => toStringUniversal(error.reason))
                        .join(', ');
                }

                return { connectionList: connections };
            }) ?? { connectionList: undefined }
        );
    }),

    setConnection: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ databaseId: z.string(), containerId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            return callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.setConnection', async () => {
                if (!input.databaseId || !input.containerId) {
                    throw new Error(l10n.t('Invalid database or container id'));
                }
                if (!ctx.connection) {
                    throw new Error(l10n.t('No connection to set'));
                }
                return resolveConnectionState(ctx, {
                    ...ctx.connection,
                    databaseId: input.databaseId,
                    containerId: input.containerId,
                });
            });
        }),

    connectToDatabase: queryEditorProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.connectToDatabase', async (context) => {
            const connection = await getNoSqlQueryConnection();
            if (connection) {
                const { databaseId, containerId } = connection;
                context.telemetry.properties.databaseId = crypto.createHash('sha256').update(databaseId).digest('hex');
                context.telemetry.properties.containerId = crypto
                    .createHash('sha256')
                    .update(containerId)
                    .digest('hex');
                context.telemetry.properties.isEmulator = connection.isEmulator.toString();
                return resolveConnectionState(ctx, connection);
            }
            return undefined;
        });
    }),

    disconnectFromDatabase: queryEditorProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.disconnectFromDatabase', async () => {
            ctx.setConnection(undefined);
            ctx.panel.title = QueryEditorTab.title;
        });
        return { disconnected: true } as const;
    }),

    openDocument: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(
            z.object({
                mode: OpenDocumentModeSchema,
                documentId: CosmosDBRecordIdentifierSchema.optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const callbackId = 'cosmosDB.nosql.queryEditor.openDocument';
            await callWithTelemetryAndErrorHandling(callbackId, () => {
                if (!ctx.connection) throw new Error(l10n.t('No connection'));
                if (!input.documentId && input.mode !== 'add') {
                    throw new Error(l10n.t('Impossible to open an item without an id'));
                }

                let viewColumn = ctx.panel.viewColumn ?? vscode.ViewColumn.Active;
                if (viewColumn === vscode.ViewColumn.Nine) {
                    viewColumn = vscode.ViewColumn.One;
                } else {
                    viewColumn += 1;
                }
                DocumentTab.render(ctx.connection, input.mode, input.documentId, viewColumn);
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
        }),

    deleteDocument: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ documentId: CosmosDBRecordIdentifierSchema }))
        .mutation(async ({ input, ctx }) => {
            const callbackId = 'cosmosDB.nosql.queryEditor.deleteDocument';
            const result = await callWithTelemetryAndErrorHandling(callbackId, async () => {
                if (!ctx.connection) throw new Error(l10n.t('No connection'));
                if (!input.documentId) throw new Error(l10n.t('Impossible to delete an item without an id'));

                const confirmation = await getConfirmationAsInSettings(
                    l10n.t('Delete Confirmation'),
                    l10n.t('Are you sure you want to delete the selected item?'),
                    'delete',
                );

                if (!confirmation) {
                    return { deleted: false } as const;
                }

                const deleted = await deleteDocument(ctx.connection, input.documentId);
                return { deleted, documentId: input.documentId } as const;
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
            return result ?? { deleted: false };
        }),

    deleteDocuments: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ documentIds: z.array(CosmosDBRecordIdentifierSchema) }))
        .mutation(async ({ input, ctx }) => {
            const callbackId = 'cosmosDB.nosql.queryEditor.deleteDocuments';
            const result = await callWithTelemetryAndErrorHandling(callbackId, async () => {
                if (!ctx.connection) throw new Error(l10n.t('No connection'));

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

                return bulkDeleteDocuments(ctx.connection, input.documentIds);
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
            return result ?? { valid: [], invalid: [], deleted: [], throttled: [], failed: [], aborted: true };
        }),

    updateQueryHistory: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ query: z.string().optional() }))
        .mutation(async ({ input, ctx }) => {
            return callWithTelemetryAndErrorHandling(
                'cosmosDB.nosql.queryEditor.updateQueryHistory',
                async (context) => {
                    context.telemetry.suppressIfSuccessful = true;
                    if (!ctx.connection) throw new Error(l10n.t('No connection'));

                    return { queryHistory: await persistQueryHistory(ctx, input.query) };
                },
            );
        }),

    updateQueryText: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ query: z.string() }))
        .mutation(async ({ input, ctx }) => {
            ctx.query = input.query;
        }),

    generateQuery: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ prompt: z.string(), currentQuery: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const callbackId = 'cosmosDB.nosql.queryEditor.generateQuery';
            const isRetry = ctx.lastGenerationFailed;
            const result = await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                context.errorHandling.suppressDisplay = true;
                context.telemetry.properties.isRetry = String(isRetry);
                ctx.lastGenerationFailed = false;

                ctx.generateQueryCancellation?.cancel();
                ctx.generateQueryCancellation?.dispose();
                ctx.generateQueryCancellation = new vscode.CancellationTokenSource();
                const token = ctx.generateQueryCancellation.token;

                try {
                    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
                    if (models.length === 0) {
                        throw new Error(
                            l10n.t('No language models available. Please ensure you have access to Copilot.'),
                        );
                    }

                    if (token.isCancellationRequested) {
                        void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (ctx) => {
                            ctx.errorHandling.suppressDisplay = true;
                            ctx.telemetry.properties.phase = 'beforeLLM';
                        });
                        return { generatedQuery: false as const };
                    }

                    const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);
                    const model = savedModelId ? (models.find((m) => m.id === savedModelId) ?? models[0]) : models[0];

                    const service = CosmosDbOperationsService.getInstance();
                    // Get history context using the tab reference from the sessions map context
                    const historyContext = ctx.connection
                        ? service.getQueryHistoryForContainer(
                              ctx.connection.accountId,
                              ctx.connection.databaseId,
                              ctx.connection.containerId,
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
                                ctx.pendingConfirmResolve = resolve;
                            });
                        },
                    });

                    if (token.isCancellationRequested) {
                        void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (ctx) => {
                            ctx.errorHandling.suppressDisplay = true;
                            ctx.telemetry.properties.phase = 'afterLLM';
                        });
                        return { generatedQuery: false as const };
                    }

                    const sanitizedPrompt = sanitizeSqlComment(input.prompt);
                    const sanitizedCurrentQuery = input.currentQuery
                        .split('\n')
                        .map((line) => sanitizeSqlComment(line))
                        .join('\n-- ');
                    const finalQuery = `-- Generated from: ${sanitizedPrompt}\n${generatedQuery.trim()}\n\n-- Previous query:\n-- ${sanitizedCurrentQuery}`;

                    ctx.isLastQueryAIGenerated = true;
                    ctx.lastAIGeneratedQuery = finalQuery;

                    return {
                        generatedQuery: finalQuery,
                        modelName: model.name,
                        prompt: input.prompt,
                    };
                } catch (error) {
                    if (token.isCancellationRequested) {
                        void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (ctx) => {
                            ctx.errorHandling.suppressDisplay = true;
                            ctx.telemetry.properties.phase = 'exception';
                        });
                        return { generatedQuery: false as const };
                    }

                    const errorMessage = parseError(error).message;
                    ctx.lastGenerationFailed = true;
                    void vscode.window.showErrorMessage(l10n.t('Failed to generate query: {0}', errorMessage));
                    throw error;
                }
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
            return result ?? { generatedQuery: false as const };
        }),

    cancelGenerateQuery: queryEditorProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        ctx.pendingConfirmResolve?.(false);
        ctx.pendingConfirmResolve = undefined;
        if (ctx.generateQueryCancellation) {
            void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (ctx) => {
                ctx.errorHandling.suppressDisplay = true;
                ctx.telemetry.properties.phase = 'userCancel';
            });
        }
        ctx.generateQueryCancellation?.cancel();
        ctx.generateQueryCancellation?.dispose();
        ctx.generateQueryCancellation = undefined;
    }),

    closeGenerateInput: queryEditorProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        ext.outputChannel.info('[Generate Query] Generate query input closed by user.');
        void callWithTelemetryAndErrorHandling('cosmosDB.ai.closeGenerateInput', (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
        });
        // Cancel any pending generation
        ctx.pendingConfirmResolve?.(false);
        ctx.pendingConfirmResolve = undefined;
        ctx.generateQueryCancellation?.cancel();
        ctx.generateQueryCancellation?.dispose();
        ctx.generateQueryCancellation = undefined;
    }),

    getSelectedModelName: queryEditorProcedure.use(trpcToTelemetry).query(async () => {
        try {
            const models = await vscode.lm.selectChatModels();
            const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);
            const selectedModel = savedModelId ? (models.find((m) => m.id === savedModelId) ?? models[0]) : models[0];
            return { modelName: selectedModel?.name ?? 'Copilot' };
        } catch {
            return { modelName: 'Copilot' };
        }
    }),

    getAvailableModels: queryEditorProcedure.use(trpcToTelemetry).query(async () => {
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

    setSelectedModel: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ modelId: z.string() }))
        .mutation(async ({ input }) => {
            await ext.context.globalState.update(SELECTED_MODEL_KEY, input.modelId);

            void callWithTelemetryAndErrorHandling('cosmosDB.ai.modelSelection', (ctx) => {
                ctx.errorHandling.suppressDisplay = true;
                ctx.telemetry.properties.modelId = input.modelId;
            });

            const models = await vscode.lm.selectChatModels();
            const selectedModel = models.find((m) => m.id === input.modelId);
            return { modelName: selectedModel?.name ?? 'Copilot' };
        }),

    openCopilotExplainQuery: queryEditorProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        void callWithTelemetryAndErrorHandling('cosmosDB.ai.explainQueryFromButton', (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
        });

        const query = ctx.query?.trim();
        const chatQuery = query ? `@cosmosdb /explainQuery\n\`\`\`sql\n${query}\n\`\`\`` : '@cosmosdb /explainQuery';
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: chatQuery });
    }),

    saveCSV: queryEditorProcedure
        .use(trpcToTelemetry)
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
        .use(trpcToTelemetry)
        .input(z.object({ name: z.string(), result: SerializedQueryResultSchema.nullable() }))
        .mutation(async ({ input }) => {
            const text = await queryMetricsToCsv(input.result);
            await vscodeUtil.showNewFile(text, input.name, '.csv');
        }),

    copyCSVToClipboard: queryEditorProcedure
        .use(trpcToTelemetry)
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
        .use(trpcToTelemetry)
        .input(z.object({ result: SerializedQueryResultSchema.nullable() }))
        .mutation(async ({ input }) => {
            const text = await queryMetricsToCsv(input.result);
            await vscode.env.clipboard.writeText(text);
        }),

    provideFeedback: queryEditorProcedure.use(trpcToTelemetry).mutation(async () => {
        openSurvey(ExperienceKind.NoSQL, 'cosmosDB.nosql.queryEditor.provideFeedback');
    }),

    reportFeedback: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ feedbackValue: z.enum(['up', 'down']), component: z.string() }))
        .mutation(async ({ input, ctx }) => {
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.reportFeedback', (context) => {
                context.telemetry.properties.feedback = input.feedbackValue;
                context.telemetry.properties.category = input.component;
                context.telemetry.properties.isAIGenerated = String(ctx.isLastQueryAIGenerated);
            });
        }),

    confirmToolInvocationResponse: queryEditorProcedure
        .use(trpcToTelemetry)
        .input(z.object({ confirmed: z.boolean() }))
        .mutation(async ({ input, ctx }) => {
            ctx.pendingConfirmResolve?.(input.confirmed);
            ctx.pendingConfirmResolve = undefined;
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
    const conn = connection ?? ctx.connection;
    if (connection) {
        ctx.setConnection(connection);
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
    if (!ctx.connection) return [];

    const storage = StorageService.get(StorageNames.Default);
    const containerId = `${ctx.connection.databaseId}/${ctx.connection.containerId}`;
    const historyItems = (await storage.getItems(HISTORY_STORAGE_KEY)) as HistoryItem[];
    const historyData = historyItems.find((item) => item.id === containerId);

    return historyData?.properties.history ?? [];
}

/**
 * Persist query history and return the updated list.
 */
async function persistQueryHistory(ctx: QueryEditorRouterContext, query?: string): Promise<string[]> {
    if (!ctx.connection) return [];

    const storage = StorageService.get(StorageNames.Default);
    const containerId = `${ctx.connection.databaseId}/${ctx.connection.containerId}`;
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
