/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type JSONValue } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import { promptAfterActionEventually } from '../../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../../utils/surveyTypes';
import * as vscodeUtil from '../../../../utils/vscodeUtils';
import { publicProcedure, router, trpcToTelemetry } from '../../extension-server/trpc';
import { type DocumentRouterContext } from '../appRouter';
import { OpenDocumentModeSchema } from '../schemas/documentSchemas';

function isCosmosDBItemDefinition(documentContent: unknown): documentContent is ItemDefinition {
    if (documentContent && typeof documentContent === 'object' && !Array.isArray(documentContent)) {
        if ('id' in documentContent) {
            return typeof documentContent.id === 'string';
        } else {
            return true;
        }
    }
    return false;
}

// ─── Document Router ────────────────────────────────────────────────────────

export const documentRouter = router({
    getInitialState: publicProcedure.use(trpcToTelemetry).query(async ({ ctx }) => {
        const myCtx = ctx as DocumentRouterContext;
        const { documentSession, connection, eventSink } = myCtx;

        eventSink.emit({
            type: 'initState',
            mode: myCtx.mode,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
            documentId: myCtx.documentId?.id ?? '',
            // PartitionKey includes NonePartitionKeyType which doesn't match the Zod schema exactly
            partitionKey: myCtx.documentId?.partitionKey as never,
        });

        if (myCtx.documentId) {
            await documentSession.read(myCtx.documentId);
        } else if (myCtx.mode === 'add') {
            await documentSession.setNewDocumentTemplate();
        }

        return {
            mode: myCtx.mode,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
        };
    }),

    refreshDocument: publicProcedure.use(trpcToTelemetry).mutation(async ({ ctx }) => {
        const myCtx = ctx as DocumentRouterContext;
        const { documentSession, eventSink } = myCtx;

        await callWithTelemetryAndErrorHandling('cosmosDB.nosql.document.refreshDocument', async () => {
            const continueItem: vscode.MessageItem = { title: l10n.t('Continue') };
            const closeItem: vscode.MessageItem = { title: l10n.t('Close'), isCloseAffordance: true };
            const message =
                l10n.t('Your item has unsaved changes. If you continue, these changes will be lost.') +
                '\n' +
                l10n.t('Are you sure you want to continue?');

            if (myCtx.isDirty) {
                const confirmation = await vscode.window.showWarningMessage(
                    message,
                    { modal: true },
                    continueItem,
                    closeItem,
                );

                if (confirmation !== continueItem) {
                    eventSink.emit({ type: 'operationAborted' });
                    return;
                }
            }

            if (myCtx.documentId) {
                await documentSession.read(myCtx.documentId);
            } else {
                await documentSession.setNewDocumentTemplate();
            }
        });
    }),

    saveDocument: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ documentText: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as DocumentRouterContext;
            const { documentSession } = myCtx;

            const callbackId = 'cosmosDB.nosql.document.saveDocument';
            await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                const documentContent: JSONValue = JSON.parse(input.documentText) as JSONValue;

                if (!isCosmosDBItemDefinition(documentContent)) {
                    throw new Error(l10n.t('Item is not a valid Cosmos DB item definition'));
                }

                const result = myCtx.documentId
                    ? await documentSession.update(documentContent, myCtx.documentId)
                    : await documentSession.create(documentContent);

                if (!result) {
                    context.errorHandling.suppressDisplay = true;
                    throw new Error(l10n.t('Failed to create item'));
                }

                myCtx.documentId = result;
                myCtx.panel.title = `${result.id}.json`;
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.High, callbackId);
        }),

    saveDocumentAsFile: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ documentText: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as DocumentRouterContext;

            const callbackId = 'cosmosDB.nosql.document.saveDocumentAsFile';
            await callWithTelemetryAndErrorHandling(callbackId, async (context) => {
                context.telemetry.suppressIfSuccessful = true;

                const documentContent: JSONValue = JSON.parse(input.documentText) as JSONValue;

                if (!isCosmosDBItemDefinition(documentContent)) {
                    throw new Error(l10n.t('Item is not a valid Cosmos DB item definition'));
                }

                await vscodeUtil.showNewFile(
                    input.documentText,
                    myCtx.documentId?.id ?? documentContent.id ?? 'Unknown',
                    '.json',
                );
            });
            void promptAfterActionEventually(ExperienceKind.NoSQL, UsageImpact.Medium, callbackId);
        }),

    setMode: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ mode: OpenDocumentModeSchema }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as DocumentRouterContext;
            const { eventSink } = myCtx;

            const newMode = input.mode;

            if (newMode === 'view' && myCtx.mode === 'edit' && myCtx.isDirty) {
                // do nothing, just keep the edit mode
                return;
            }

            myCtx.mode = newMode;
            eventSink.emit({ type: 'modeChanged', mode: newMode });
        }),

    setDirty: publicProcedure
        .use(trpcToTelemetry)
        .input(z.object({ isDirty: z.boolean() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as DocumentRouterContext;
            myCtx.isDirty = input.isDirty;
        }),
});
