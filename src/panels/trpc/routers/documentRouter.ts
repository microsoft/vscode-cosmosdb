/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type JSONValue, type PartitionKeyDefinition } from '@azure/cosmos';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type NoSqlQueryConnection } from '../../../cosmosdb/NoSqlQueryConnection';
import {
    buildNewDocumentTemplate,
    createDocument,
    deleteDocument,
    extractPartitionKeyFromDocument,
    readDocument,
    replaceDocument,
} from '../../../cosmosdb/session/DocumentSession';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { arePartitionKeysEqual } from '../../../utils/document';
import { promptAfterActionEventually } from '../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../utils/surveyTypes';
import * as vscodeUtil from '../../../utils/vscodeUtils';
import { type DocumentMutableState, type DocumentRouterContext } from '../appRouter';
import { OpenDocumentModeSchema } from '../schemas/documentSchemas';
import { documentProcedure, documentRouter } from '../trpc';

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

// ─── Document Router (Controller) ───────────────────────────────────────────
//
// This router is the controller for the document view. It orchestrates all
// business logic: confirmation dialogs, partition key change handling,
// error display, and returns results directly to the webview client.
//
// Telemetry is handled by the middleware — procedures use `ctx.actionContext`
// to set custom properties instead of wrapping in `callWithTelemetryAndErrorHandling`.

export const documentRouterDef = documentRouter({
    getInitialState: documentProcedure.query(async ({ ctx }) => {
        const { connection, state } = ctx;

        let documentContent: object | undefined;
        let documentPartitionKey: PartitionKeyDefinition | undefined;

        if (state.documentId) {
            const result = await readDocument(connection, state.documentId, ctx.signal, state.partitionKeyDefinition);
            documentContent = result?.documentContent;
            documentPartitionKey = result?.partitionKey;
            if (result?.partitionKey) state.partitionKeyDefinition = result.partitionKey;
        } else if (state.mode === 'add') {
            const result = await buildNewDocumentTemplate(connection, state.partitionKeyDefinition);
            documentContent = result?.documentContent;
            documentPartitionKey = result?.partitionKey;
            if (result?.partitionKey) state.partitionKeyDefinition = result.partitionKey;
        }

        return {
            mode: state.mode,
            databaseId: connection.databaseId,
            containerId: connection.containerId,
            documentId: state.documentId,
            documentContent,
            documentPartitionKey,
        };
    }),

    refreshDocument: documentProcedure.mutation(async ({ ctx }) => {
        const { connection, state } = ctx;

        if (state.isDirty) {
            const continueItem: vscode.MessageItem = { title: l10n.t('Continue') };
            const closeItem: vscode.MessageItem = { title: l10n.t('Close'), isCloseAffordance: true };
            const message =
                l10n.t('Your item has unsaved changes. If you continue, these changes will be lost.') +
                '\n' +
                l10n.t('Are you sure you want to continue?');

            const confirmation = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                continueItem,
                closeItem,
            );

            if (confirmation !== continueItem) {
                return { aborted: true } as const;
            }
        }

        let documentResult;
        if (state.documentId) {
            documentResult = await readDocument(connection, state.documentId, ctx.signal, state.partitionKeyDefinition);
        } else {
            documentResult = await buildNewDocumentTemplate(connection, state.partitionKeyDefinition);
        }

        if (documentResult?.partitionKey) state.partitionKeyDefinition = documentResult.partitionKey;

        return {
            aborted: false,
            documentContent: documentResult?.documentContent,
            partitionKey: documentResult?.partitionKey,
        } as const;
    }),

    saveDocument: documentProcedure.input(z.object({ documentText: z.string() })).mutation(async ({ input, ctx }) => {
        const { connection, state } = ctx;

        const documentContent: JSONValue = JSON.parse(input.documentText) as JSONValue;

        if (!isCosmosDBItemDefinition(documentContent)) {
            throw new Error(l10n.t('Item is not a valid Cosmos DB item definition'));
        }

        let saveResult;
        if (state.documentId) {
            // Update existing document
            saveResult = await updateDocument(connection, documentContent, state, ctx);
        } else {
            // Create new document
            saveResult = await createDocument(connection, documentContent, ctx.signal, state.partitionKeyDefinition);
            if (!saveResult) {
                throw new Error(l10n.t('Failed to create item'));
            }

            if (saveResult.partitionKey) state.partitionKeyDefinition = saveResult.partitionKey;
            state.documentId = saveResult.identifier;
            ctx.panel.title = `${saveResult.identifier.id}.json`;
        }

        void promptAfterActionEventually(
            ExperienceKind.NoSQL,
            UsageImpact.High,
            'cosmosDB.nosql.document.saveDocument',
        );

        if (!saveResult) {
            return { success: false } as const;
        }

        return {
            success: true,
            documentContent: saveResult.documentContent,
            partitionKey: saveResult.partitionKey,
        } as const;
    }),

    saveDocumentAsFile: documentProcedure
        .input(z.object({ documentText: z.string() }))
        .mutation(async ({ input, ctx }) => {
            if (ctx.actionContext) {
                ctx.actionContext.telemetry.suppressIfSuccessful = true;
            }

            const documentContent: JSONValue = JSON.parse(input.documentText) as JSONValue;

            if (!isCosmosDBItemDefinition(documentContent)) {
                throw new Error(l10n.t('Item is not a valid Cosmos DB item definition'));
            }

            await vscodeUtil.showNewFile(
                input.documentText,
                ctx.state.documentId?.id ?? documentContent.id ?? 'Unknown',
                '.json',
            );

            void promptAfterActionEventually(
                ExperienceKind.NoSQL,
                UsageImpact.Medium,
                'cosmosDB.nosql.document.saveDocumentAsFile',
            );
        }),

    setMode: documentProcedure.input(z.object({ mode: OpenDocumentModeSchema })).mutation(({ input, ctx }) => {
        const { state } = ctx;
        const newMode = input.mode;

        if (newMode === 'view' && state.mode === 'edit' && state.isDirty) {
            return { mode: state.mode };
        }

        state.mode = newMode;
        return { mode: newMode };
    }),

    setDirty: documentProcedure.input(z.object({ isDirty: z.boolean() })).mutation(({ input, ctx }) => {
        ctx.state.isDirty = input.isDirty;
    }),
});

/**
 * Handle document update with partition key change detection.
 * If the partition key changed, confirms with the user, deletes the old document,
 * and creates a new one. Otherwise, does a simple replace.
 */
async function updateDocument(
    connection: NoSqlQueryConnection,
    documentContent: ItemDefinition,
    state: DocumentMutableState,
    ctx: DocumentRouterContext & { actionContext?: IActionContext },
) {
    const documentId = state.documentId!;
    const actionContext = ctx.actionContext;

    // Check if partition key has changed
    const newPartitionKey = await extractPartitionKeyFromDocument(
        connection,
        documentContent,
        state.partitionKeyDefinition,
    );
    const partitionKeyChanged = !arePartitionKeysEqual(documentId.partitionKey, newPartitionKey);

    if (partitionKeyChanged) {
        if (actionContext) actionContext.telemetry.properties.partitionKeyChanged = 'true';

        const confirmation = await getConfirmationAsInSettings(
            l10n.t('Partition Key changed'),
            l10n.t(
                'Are you sure you want to change the items partition key?\n\nThis will delete the old item and create a new one.',
            ),
            'change',
        );

        if (!confirmation) {
            if (actionContext) actionContext.telemetry.properties.result = 'Canceled';
            return undefined;
        }

        // Delete old document, then create new one
        await deleteDocument(connection, documentId, ctx.signal);

        const result = await createDocument(connection, documentContent, ctx.signal, state.partitionKeyDefinition);
        if (!result) {
            throw new Error(l10n.t('Item update with partition key change failed'));
        }

        if (result.partitionKey) state.partitionKeyDefinition = result.partitionKey;
        state.documentId = result.identifier;
        ctx.panel.title = `${result.identifier.id}.json`;
        return result;
    } else {
        // Simple replace
        if (actionContext) actionContext.telemetry.properties.partitionKeyChanged = 'false';

        const result = await replaceDocument(
            connection,
            documentContent,
            documentId,
            ctx.signal,
            state.partitionKeyDefinition,
        );
        if (!result) {
            throw new Error(l10n.t('Failed to update item'));
        }

        if (result.partitionKey) state.partitionKeyDefinition = result.partitionKey;
        state.documentId = result.identifier;
        ctx.panel.title = `${result.identifier.id}.json`;
        return result;
    }
}
