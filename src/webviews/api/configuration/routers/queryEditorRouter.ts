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
import { createDocumentEventEmitter, DocumentSession } from '../../../../cosmosdb/session/DocumentSession';
import { createQueryEventEmitter, QuerySession } from '../../../../cosmosdb/session/QuerySession';
import { type CosmosDBRecordIdentifier, type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';
import { withClaimsChallengeHandling } from '../../../../cosmosdb/withClaimsChallengeHandling';
import { ext } from '../../../../extensionVariables';
import { DocumentTab } from '../../../../panels/DocumentTab';
import { QueryEditorTab } from '../../../../panels/QueryEditorTab';
import { StorageNames, StorageService, type StorageItem } from '../../../../services/StorageService';
import { toStringUniversal } from '../../../../utils/convertors';
import { queryMetricsToCsv, queryResultToCsv } from '../../../../utils/csvConverter';
import { sanitizeSqlComment } from '../../../../utils/sanitization';
import { getIsSurveyDisabledGlobally, openSurvey, promptAfterActionEventually } from '../../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../../utils/surveyTypes';
import * as vscodeUtil from '../../../../utils/vscodeUtils';
import { publicProcedure, router, trpcToTelemetry } from '../../extension-server/trpc';
import { type QueryEditorRouterContext } from '../appRouter';
import {
    CosmosDBRecordIdentifierSchema,
    OpenDocumentModeSchema,
    PartitionKeyDefinitionSchema,
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

// ─── Query Editor Router ────────────────────────────────────────────────────

export const queryEditorRouter = router({
    /**
     * Initializes the query editor webview with connection state, query history,
     * throughput buckets, initial query, survey status, and AI features status.
     */
    init: publicProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.init', async (context) => {
            context.telemetry.suppressIfSuccessful = true;

            if (myCtx.connection) {
                try {
                    await updateConnection(myCtx, myCtx.connection);
                } catch {
                    // Fall through — connection may be stale
                }
            } else {
                myCtx.panel.title = QueryEditorTab.title;
                myCtx.eventSink.emit({ type: 'databaseDisconnected' });
            }

            // Update query history
            await updateQueryHistory(myCtx);

            // Update throughput buckets
            if (myCtx.connection) {
                myCtx.eventSink.emit({
                    type: 'updateThroughputBuckets',
                    throughputBuckets: [true, true, true, true, true],
                });
            }

            // Send initial query if present
            if (myCtx.query) {
                myCtx.eventSink.emit({ type: 'fileOpened', query: myCtx.query });
            }

            myCtx.eventSink.emit({
                type: 'isSurveyCandidateChanged',
                isSurveyCandidate: !getIsSurveyDisabledGlobally(),
            });

            myCtx.eventSink.emit({ type: 'aiFeaturesEnabledChanged', isEnabled: ext.isAIFeaturesEnabled });
        });
    }),

    runQuery: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ query: z.string(), options: QueryMetadataSchema }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            myCtx.query = input.query;

            const wasAIGenerated = myCtx.isLastQueryAIGenerated;
            const wasModified =
                wasAIGenerated &&
                myCtx.lastAIGeneratedQuery !== undefined &&
                input.query !== myCtx.lastAIGeneratedQuery;
            myCtx.isLastQueryAIGenerated = false;
            myCtx.lastAIGeneratedQuery = undefined;

            const callbackId = 'cosmosDB.nosql.queryEditor.runQuery';
            await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                if (!myCtx.connection) {
                    throw new Error(l10n.t('No connection'));
                }

                context.telemetry.properties.isAIGenerated = String(wasAIGenerated);
                if (wasAIGenerated) {
                    context.telemetry.properties.isQueryModified = String(wasModified);
                }

                if (input.options.sessionId) {
                    const existingSession = myCtx.sessions.get(input.options.sessionId);
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
                            return;
                        }
                    }
                }

                const eventEmitter = createQueryEventEmitter(myCtx.eventSink);
                const session = new QuerySession(myCtx.connection, eventEmitter, input.query, input.options);
                context.telemetry.properties.executionId = session.id;

                myCtx.sessions.forEach((existingSession) => existingSession.dispose());
                myCtx.sessions.clear();
                myCtx.sessions.set(session.id, session);

                await session.run();
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.High, callbackId);
        }),

    stopQuery: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ executionId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.stopQuery', async (context) => {
                context.telemetry.properties.executionId = input.executionId;
                const session = myCtx.sessions.get(input.executionId);
                if (!session) {
                    throw new Error(
                        l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                    );
                }
                await session.stop();
                myCtx.sessions.delete(input.executionId);
            });
        }),

    nextPage: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ executionId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            const callbackId = 'cosmosDB.nosql.queryEditor.nextPage';
            await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                context.telemetry.properties.executionId = input.executionId;
                if (!myCtx.connection) throw new Error(l10n.t('No connection'));
                const session = myCtx.sessions.get(input.executionId);
                if (!session)
                    throw new Error(
                        l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                    );
                await session.nextPage();
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
        }),

    prevPage: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ executionId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            const callbackId = 'cosmosDB.nosql.queryEditor.prevPage';
            await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                context.telemetry.properties.executionId = input.executionId;
                if (!myCtx.connection) throw new Error(l10n.t('No connection'));
                const session = myCtx.sessions.get(input.executionId);
                if (!session)
                    throw new Error(
                        l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                    );
                await session.prevPage();
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
        }),

    firstPage: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ executionId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            const callbackId = 'cosmosDB.nosql.queryEditor.firstPage';
            await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                context.telemetry.properties.executionId = input.executionId;
                if (!myCtx.connection) throw new Error(l10n.t('No connection'));
                const session = myCtx.sessions.get(input.executionId);
                if (!session)
                    throw new Error(
                        l10n.t('No session found for executionId: {executionId}', { executionId: input.executionId }),
                    );
                await session.firstPage();
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
        }),

    openFile: publicProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
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

        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.openFile', async () => {
            await vscode.window.showOpenDialog(options).then((fileUri) => {
                if (fileUri && fileUri[0]) {
                    return vscode.workspace.openTextDocument(fileUri[0]).then((document) => {
                        myCtx.eventSink.emit({ type: 'fileOpened', query: document.getText() });
                    });
                }
                return undefined;
            });
        });
    }),

    saveFile: publicProcedure
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

    duplicateTab: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ text: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.duplicateTab', () => {
                // Import dynamically to avoid circular dependency

                QueryEditorTab.render(myCtx.connection, myCtx.panel.viewColumn, false, input.text);
            });
        }),

    copyToClipboard: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ text: z.string() }))
        .mutation(async ({ input }) => {
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.copyToClipboard', async () => {
                await vscode.env.clipboard.writeText(input.text);
            });
        }),

    getConnections: publicProcedure.use(trpcToTelemetry).query(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
        return callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.getConnections', async (context) => {
            if (!myCtx.connection) {
                myCtx.eventSink.emit({ type: 'setConnectionList' });
                return;
            }

            const cosmosClient = getCosmosClient(myCtx.connection);
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
                context.telemetry.properties.error = errors.map((error) => toStringUniversal(error.reason)).join(', ');
            }

            myCtx.eventSink.emit({ type: 'setConnectionList', connectionList: connections });
        });
    }),

    setConnection: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ databaseId: z.string(), containerId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.setConnection', async () => {
                if (!input.databaseId || !input.containerId) {
                    throw new Error(l10n.t('Invalid database or container id'));
                }
                if (!myCtx.connection) {
                    throw new Error(l10n.t('No connection to set'));
                }
                await updateConnection(myCtx, {
                    ...myCtx.connection,
                    databaseId: input.databaseId,
                    containerId: input.containerId,
                });
            });
        }),

    connectToDatabase: publicProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.connectToDatabase', async (context) => {
            const connection = await getNoSqlQueryConnection();
            if (connection) {
                const { databaseId, containerId } = connection;
                context.telemetry.properties.databaseId = crypto.createHash('sha256').update(databaseId).digest('hex');
                context.telemetry.properties.containerId = crypto
                    .createHash('sha256')
                    .update(containerId)
                    .digest('hex');
                context.telemetry.properties.isEmulator = connection.isEmulator.toString();
                await updateConnection(myCtx, connection);
            }
        });
    }),

    disconnectFromDatabase: publicProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.disconnectFromDatabase', async () => {
            await updateConnection(myCtx, undefined);
        });
    }),

    openDocument: publicProcedure
        .use(trpcToTelemetry)
        .input(
            z.object({
                mode: OpenDocumentModeSchema,
                documentId: CosmosDBRecordIdentifierSchema.optional(),
            }),
        )
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            const callbackId = 'cosmosDB.nosql.queryEditor.openDocument';
            await callWithTelemetryAndErrorHandling(callbackId, () => {
                if (!myCtx.connection) throw new Error(l10n.t('No connection'));
                if (!input.documentId && input.mode !== 'add') {
                    throw new Error(l10n.t('Impossible to open an item without an id'));
                }

                let viewColumn = myCtx.panel.viewColumn ?? vscode.ViewColumn.Active;
                if (viewColumn === vscode.ViewColumn.Nine) {
                    viewColumn = vscode.ViewColumn.One;
                } else {
                    viewColumn += 1;
                }
                DocumentTab.render(
                    myCtx.connection,
                    input.mode,
                    input.documentId as CosmosDBRecordIdentifier | undefined,
                    viewColumn,
                );
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
        }),

    deleteDocument: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ documentId: CosmosDBRecordIdentifierSchema }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            const callbackId = 'cosmosDB.nosql.queryEditor.deleteDocument';
            await callWithTelemetryAndErrorHandling(callbackId, async () => {
                if (!myCtx.connection) throw new Error(l10n.t('No connection'));
                if (!input.documentId) throw new Error(l10n.t('Impossible to delete an item without an id'));

                const eventEmitter = createDocumentEventEmitter(myCtx.eventSink);
                const session = new DocumentSession(myCtx.connection, eventEmitter);
                await session.delete(input.documentId as CosmosDBRecordIdentifier);
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
        }),

    deleteDocuments: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ documentIds: z.array(CosmosDBRecordIdentifierSchema) }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            const callbackId = 'cosmosDB.nosql.queryEditor.deleteDocuments';
            await callWithTelemetryAndErrorHandling(callbackId, async () => {
                if (!myCtx.connection) throw new Error(l10n.t('No connection'));

                const eventEmitter = createDocumentEventEmitter(myCtx.eventSink);
                const session = new DocumentSession(myCtx.connection, eventEmitter);
                await session.bulkDelete(input.documentIds as CosmosDBRecordIdentifier[]);
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
        }),

    updateQueryHistory: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ query: z.string().optional() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            await callWithTelemetryAndErrorHandling(
                'cosmosDB.nosql.queryEditor.updateQueryHistory',
                async (context) => {
                    context.telemetry.suppressIfSuccessful = true;
                    if (!myCtx.connection) throw new Error(l10n.t('No connection'));

                    await updateQueryHistory(myCtx, input.query);
                },
            );
        }),

    updateQueryText: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ query: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            myCtx.query = input.query;
        }),

    generateQuery: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ prompt: z.string(), currentQuery: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            const callbackId = 'cosmosDB.nosql.queryEditor.generateQuery';
            const isRetry = myCtx.lastGenerationFailed;
            await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                context.errorHandling.suppressDisplay = true;
                context.telemetry.properties.isRetry = String(isRetry);
                myCtx.lastGenerationFailed = false;

                myCtx.generateQueryCancellation?.cancel();
                myCtx.generateQueryCancellation?.dispose();
                myCtx.generateQueryCancellation = new vscode.CancellationTokenSource();
                const token = myCtx.generateQueryCancellation.token;

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
                        myCtx.eventSink.emit({ type: 'queryGenerated', generatedQuery: false });
                        return;
                    }

                    const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);
                    const model = savedModelId ? (models.find((m) => m.id === savedModelId) ?? models[0]) : models[0];

                    const service = CosmosDbOperationsService.getInstance();
                    // Get history context using the tab reference from the sessions map context
                    const historyContext = myCtx.connection
                        ? service.getQueryHistoryForContainer(
                              myCtx.connection.accountId,
                              myCtx.connection.databaseId,
                              myCtx.connection.containerId,
                          )
                        : undefined;

                    const generatedQuery = await service.generateQueryWithLLM(input.prompt, input.currentQuery, {
                        modelId: model.id,
                        historyContext,
                        cancellationToken: token,
                        source: 'queryEditor',
                        operation: 'generateQuery',
                        onConfirm: async (message: string) => {
                            myCtx.eventSink.emit({ type: 'confirmToolInvocation', message });
                            return new Promise<boolean>((resolve) => {
                                myCtx.pendingConfirmResolve = resolve;
                            });
                        },
                    });

                    if (token.isCancellationRequested) {
                        void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (ctx) => {
                            ctx.errorHandling.suppressDisplay = true;
                            ctx.telemetry.properties.phase = 'afterLLM';
                        });
                        myCtx.eventSink.emit({ type: 'queryGenerated', generatedQuery: false });
                        return;
                    }

                    const sanitizedPrompt = sanitizeSqlComment(input.prompt);
                    const sanitizedCurrentQuery = input.currentQuery
                        .split('\n')
                        .map((line) => sanitizeSqlComment(line))
                        .join('\n-- ');
                    const finalQuery = `-- Generated from: ${sanitizedPrompt}\n${generatedQuery.trim()}\n\n-- Previous query:\n-- ${sanitizedCurrentQuery}`;

                    myCtx.isLastQueryAIGenerated = true;
                    myCtx.lastAIGeneratedQuery = finalQuery;

                    myCtx.eventSink.emit({
                        type: 'queryGenerated',
                        generatedQuery: finalQuery,
                        modelName: model.name,
                        prompt: input.prompt,
                    });
                } catch (error) {
                    if (token.isCancellationRequested) {
                        void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (ctx) => {
                            ctx.errorHandling.suppressDisplay = true;
                            ctx.telemetry.properties.phase = 'exception';
                        });
                        myCtx.eventSink.emit({ type: 'queryGenerated', generatedQuery: false });
                        return;
                    }

                    const errorMessage = parseError(error).message;
                    myCtx.lastGenerationFailed = true;
                    myCtx.eventSink.emit({ type: 'queryGenerated', generatedQuery: false });
                    void vscode.window.showErrorMessage(l10n.t('Failed to generate query: {0}', errorMessage));
                    throw error;
                }
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
        }),

    cancelGenerateQuery: publicProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
        myCtx.pendingConfirmResolve?.(false);
        myCtx.pendingConfirmResolve = undefined;
        if (myCtx.generateQueryCancellation) {
            void callWithTelemetryAndErrorHandling('cosmosDB.ai.queryGenerationCancelled', (ctx) => {
                ctx.errorHandling.suppressDisplay = true;
                ctx.telemetry.properties.phase = 'userCancel';
            });
        }
        myCtx.generateQueryCancellation?.cancel();
        myCtx.generateQueryCancellation?.dispose();
        myCtx.generateQueryCancellation = undefined;
    }),

    closeGenerateInput: publicProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
        ext.outputChannel.info('[Generate Query] Generate query input closed by user.');
        void callWithTelemetryAndErrorHandling('cosmosDB.ai.closeGenerateInput', (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
        });
        // Cancel any pending generation
        myCtx.pendingConfirmResolve?.(false);
        myCtx.pendingConfirmResolve = undefined;
        myCtx.generateQueryCancellation?.cancel();
        myCtx.generateQueryCancellation?.dispose();
        myCtx.generateQueryCancellation = undefined;
    }),

    getSelectedModelName: publicProcedure.use(trpcToTelemetry).query(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
        try {
            const models = await vscode.lm.selectChatModels();
            const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);
            const selectedModel = savedModelId ? (models.find((m) => m.id === savedModelId) ?? models[0]) : models[0];
            const modelName = selectedModel?.name ?? 'Copilot';
            myCtx.eventSink.emit({ type: 'selectedModelName', modelName });
            return { modelName };
        } catch {
            myCtx.eventSink.emit({ type: 'selectedModelName', modelName: 'Copilot' });
            return { modelName: 'Copilot' };
        }
    }),

    getAvailableModels: publicProcedure.use(trpcToTelemetry).query(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
        try {
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);

            const modelList = models
                .filter((m) => m.name.toLowerCase() !== 'auto')
                .map((m) => ({ id: m.id, name: m.name, family: m.family, vendor: m.vendor }));

            myCtx.eventSink.emit({ type: 'availableModels', models: modelList, savedModelId: savedModelId ?? null });
            return { models: modelList, savedModelId: savedModelId ?? null };
        } catch {
            myCtx.eventSink.emit({ type: 'availableModels', models: [], savedModelId: null });
            return { models: [], savedModelId: null };
        }
    }),

    setSelectedModel: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ modelId: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            await ext.context.globalState.update(SELECTED_MODEL_KEY, input.modelId);

            void callWithTelemetryAndErrorHandling('cosmosDB.ai.modelSelection', (ctx) => {
                ctx.errorHandling.suppressDisplay = true;
                ctx.telemetry.properties.modelId = input.modelId;
            });

            const models = await vscode.lm.selectChatModels();
            const selectedModel = models.find((m) => m.id === input.modelId);
            myCtx.eventSink.emit({ type: 'selectedModelName', modelName: selectedModel?.name ?? 'Copilot' });
        }),

    openCopilotExplainQuery: publicProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        const myCtx = ctx as QueryEditorRouterContext;
        void callWithTelemetryAndErrorHandling('cosmosDB.ai.explainQueryFromButton', (ctx) => {
            ctx.errorHandling.suppressDisplay = true;
        });

        const query = myCtx.query?.trim();
        const chatQuery = query ? `@cosmosdb /explainQuery\n\`\`\`sql\n${query}\n\`\`\`` : '@cosmosdb /explainQuery';
        await vscode.commands.executeCommand('workbench.action.chat.open', { query: chatQuery });
    }),

    saveCSV: publicProcedure
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
            const text = await queryResultToCsv(
                input.result as SerializedQueryResult | null,
                input.partitionKey as PartitionKeyDefinition | undefined,
                input.selection,
            );
            await vscodeUtil.showNewFile(text, input.name, '.csv');
        }),

    saveMetricsCSV: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ name: z.string(), result: SerializedQueryResultSchema.nullable() }))
        .mutation(async ({ input }) => {
            const text = await queryMetricsToCsv(input.result as SerializedQueryResult | null);
            await vscodeUtil.showNewFile(text, input.name, '.csv');
        }),

    copyCSVToClipboard: publicProcedure
        .use(trpcToTelemetry)
        .input(
            z.object({
                result: SerializedQueryResultSchema.nullable(),
                partitionKey: PartitionKeyDefinitionSchema.optional(),
                selection: z.array(z.number()).optional(),
            }),
        )
        .mutation(async ({ input }) => {
            const text = await queryResultToCsv(
                input.result as SerializedQueryResult | null,
                input.partitionKey as PartitionKeyDefinition | undefined,
                input.selection,
            );
            await vscode.env.clipboard.writeText(text);
        }),

    copyMetricsCSVToClipboard: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ result: SerializedQueryResultSchema.nullable() }))
        .mutation(async ({ input }) => {
            const text = await queryMetricsToCsv(input.result as SerializedQueryResult | null);
            await vscode.env.clipboard.writeText(text);
        }),

    provideFeedback: publicProcedure.use(trpcToTelemetry).mutation(async () => {
        openSurvey(ExperienceKind.NoSQL, 'cosmosDB.nosql.queryEditor.provideFeedback');
    }),

    reportFeedback: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ feedbackValue: z.enum(['up', 'down']), component: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            await callWithTelemetryAndErrorHandling('cosmosDB.nosql.queryEditor.reportFeedback', (context) => {
                context.telemetry.properties.feedback = input.feedbackValue;
                context.telemetry.properties.category = input.component;
                context.telemetry.properties.isAIGenerated = String(myCtx.isLastQueryAIGenerated);
            });
        }),

    confirmToolInvocationResponse: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ confirmed: z.boolean() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as QueryEditorRouterContext;
            myCtx.pendingConfirmResolve?.(input.confirmed);
            myCtx.pendingConfirmResolve = undefined;
        }),
});

// Helper to update connection state and emit events
async function updateConnection(myCtx: QueryEditorRouterContext, connection?: NoSqlQueryConnection): Promise<void> {
    myCtx.setConnection(connection);

    if (connection) {
        const { databaseId, containerId } = connection;

        const container = await withClaimsChallengeHandling(connection, async (client) =>
            client.database(databaseId).container(containerId).read(),
        );

        if (container.resource === undefined) {
            throw new Error(l10n.t('Container {0} not found', containerId));
        }

        const containerDefinition = container.resource;
        myCtx.panel.title = `${databaseId}/${containerId}`;

        myCtx.eventSink.emit({
            type: 'databaseConnected',
            dbName: databaseId,
            containerName: containerId,
            partitionKey: containerDefinition.partitionKey,
        });
    } else {
        myCtx.panel.title = QueryEditorTab.title;
        myCtx.eventSink.emit({ type: 'databaseDisconnected' });
    }
}

// Helper to update query history and emit events
async function updateQueryHistory(myCtx: QueryEditorRouterContext, query?: string): Promise<void> {
    if (!myCtx.connection) return;

    const storage = StorageService.get(StorageNames.Default);
    const containerId = `${myCtx.connection.databaseId}/${myCtx.connection.containerId}`;
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

    myCtx.eventSink.emit({ type: 'updateQueryHistory', queryHistory: historyData.properties.history });
}
