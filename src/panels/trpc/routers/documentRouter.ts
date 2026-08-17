/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type JSONValue, type PartitionKeyDefinition } from '@azure/cosmos';
import { type NoSQLDocument } from '@cosmosdb/schema-analyzer/json';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type NoSqlQueryConnection } from '../../../cosmosdb/NoSqlQueryConnection';
import {
    buildNewDocumentTemplate,
    createDocument,
    deleteDocument,
    type DocumentResult,
    type DocumentWriteResult,
    extractPartitionKeyFromDocument,
    readDocument,
    replaceDocument,
} from '../../../cosmosdb/session/DocumentSession';
import { SchemaService } from '../../../services/SchemaService';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { arePartitionKeysEqual } from '../../../utils/document';
import { promptAfterActionEventually } from '../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../utils/surveyTypes';
import * as vscodeUtil from '../../../utils/vscodeUtils';
import { type DocumentMutableState, type DocumentRouterContext } from '../appRouter';
import { OpenDocumentModeSchema } from '../schemas';
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
            state.documentEtag = result?.documentContent._etag;
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
            cleanupRequiredMessage: state.pendingPartitionKeyCleanup
                ? (state.pendingPartitionKeyCleanup.message ?? getPartitionKeyCleanupRequiredMessage())
                : undefined,
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
        state.documentEtag = documentResult?.documentContent._etag;

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
            const updateResult = await updateDocument(connection, documentContent, state, ctx);
            if (updateResult && ('cleanupRequired' in updateResult || 'aborted' in updateResult)) {
                return updateResult;
            }
            if (updateResult && 'discarded' in updateResult) {
                return {
                    success: true,
                    discarded: true,
                    documentContent: updateResult.documentContent,
                    partitionKey: updateResult.partitionKey,
                } as const;
            }
            saveResult = updateResult;
        } else {
            // Create new document
            saveResult = await createDocument(connection, documentContent, ctx.signal, state.partitionKeyDefinition);
            if (!saveResult) {
                throw new Error(l10n.t('Failed to create item'));
            }

            if (saveResult.partitionKey) state.partitionKeyDefinition = saveResult.partitionKey;
            state.documentId = saveResult.identifier;
            state.documentEtag = saveResult.documentContent._etag;
            ctx.panel.title = `${saveResult.identifier.id}.json`;

            // Fire-and-forget: refresh the persisted container schema with the
            // newly created document. Only runs when a schema already exists for
            // this container; we never start tracking schema implicitly here.
            void refreshSchemaForNewDocument(connection, saveResult.documentContent);
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

    retryPartitionKeyCleanup: documentProcedure.mutation(async ({ ctx }) => {
        const pendingCleanup = ctx.state.pendingPartitionKeyCleanup;
        if (!pendingCleanup) {
            console.warn('[Document] Partition key cleanup retry requested with no pending cleanup.');
            const currentDocument = ctx.state.documentId
                ? await readDocument(ctx.connection, ctx.state.documentId, undefined, ctx.state.partitionKeyDefinition)
                : undefined;
            ctx.state.documentEtag = currentDocument?.documentContent._etag;
            return {
                success: true,
                cleanupRequired: false,
                documentContent: currentDocument?.documentContent,
                partitionKey: currentDocument?.partitionKey,
            } as const;
        }

        try {
            await deletePartitionKeyMoveSource(
                ctx.connection,
                pendingCleanup.sourceIdentifier,
                pendingCleanup.sourceEtag,
            );
        } catch (error) {
            if (!isPreconditionFailed(error)) {
                return cleanupRequiredResult();
            }

            let currentSource: DocumentResult | undefined;
            try {
                currentSource = await readDocument(
                    ctx.connection,
                    pendingCleanup.sourceIdentifier,
                    undefined,
                    ctx.state.partitionKeyDefinition,
                );
            } catch {
                return cleanupRequiredResult();
            }
            if (!currentSource) {
                return cleanupRequiredResult();
            }

            const resolution = await promptForDocumentConflict();
            if (resolution === 'overwrite') {
                const currentSourceEtag = currentSource.documentContent._etag;
                if (!currentSourceEtag) {
                    return cleanupRequiredResult();
                }
                pendingCleanup.sourceEtag = currentSourceEtag;
                try {
                    await deletePartitionKeyMoveSource(
                        ctx.connection,
                        pendingCleanup.sourceIdentifier,
                        pendingCleanup.sourceEtag,
                    );
                } catch {
                    return cleanupRequiredResult();
                }
            } else if (resolution === 'discard') {
                const destinationEtag = pendingCleanup.destination.documentContent._etag;
                if (!destinationEtag) {
                    pendingCleanup.message = getPartitionKeyRollbackRequiredMessage();
                    return cleanupRequiredResult(pendingCleanup.message);
                }
                try {
                    await deletePartitionKeyMoveSource(
                        ctx.connection,
                        pendingCleanup.destination.identifier,
                        destinationEtag,
                    );
                } catch {
                    pendingCleanup.message = getPartitionKeyRollbackRequiredMessage();
                    return cleanupRequiredResult(pendingCleanup.message);
                }

                ctx.state.documentId = pendingCleanup.sourceIdentifier;
                ctx.state.pendingPartitionKeyCleanup = undefined;
                updateLoadedDocumentState(ctx.state, currentSource);
                ctx.panel.title = `${pendingCleanup.sourceIdentifier.id}.json`;
                return {
                    success: true,
                    cleanupRequired: false,
                    documentContent: currentSource.documentContent,
                    partitionKey: currentSource.partitionKey,
                } as const;
            } else {
                return cleanupRequiredResult();
            }
        }

        try {
            const currentDestination = await readDocument(
                ctx.connection,
                pendingCleanup.destination.identifier,
                undefined,
                pendingCleanup.destination.partitionKey,
            );
            if (!currentDestination) {
                throw new Error('Partition key move destination could not be confirmed');
            }

            const currentDestinationResult = {
                ...currentDestination,
                identifier: pendingCleanup.destination.identifier,
            };
            completePartitionKeyMove(ctx, currentDestinationResult);
            return {
                success: true,
                cleanupRequired: false,
                documentContent: currentDestination.documentContent,
                partitionKey: currentDestination.partitionKey,
            } as const;
        } catch {
            pendingCleanup.message = getPartitionKeyDestinationRefreshRequiredMessage();
            return {
                success: false,
                cleanupRequired: true,
                message: pendingCleanup.message,
            } as const;
        }
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
 * If the partition key changed, confirms with the user, creates a new document,
 * and deletes the old one. Otherwise, does a simple replace.
 */
async function updateDocument(
    connection: NoSqlQueryConnection,
    documentContent: ItemDefinition,
    state: DocumentMutableState,
    ctx: DocumentRouterContext & { actionContext?: IActionContext },
) {
    if (state.pendingPartitionKeyCleanup) {
        return {
            success: false,
            cleanupRequired: true,
            message: getPartitionKeyCleanupRequiredMessage(),
        } as const;
    }

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

        if (state.documentEtag) {
            const currentDocument = await readDocument(
                connection,
                documentId,
                ctx.signal,
                state.partitionKeyDefinition,
            );
            if (currentDocument && currentDocument.documentContent._etag !== state.documentEtag) {
                const resolution = await promptForDocumentConflict();
                if (resolution === 'discard') {
                    updateLoadedDocumentState(state, currentDocument);
                    return { discarded: true, ...currentDocument } as const;
                }
                if (resolution !== 'overwrite') {
                    return { success: false, aborted: true } as const;
                }
                state.documentEtag = currentDocument.documentContent._etag;
            }
        }

        const confirmation = await getConfirmationAsInSettings(
            l10n.t('Partition Key changed'),
            l10n.t(
                'Are you sure you want to change the items partition key?\n\nThis will create the item in the new partition before deleting the original. If deletion fails, both items may temporarily exist.',
            ),
            'change',
        );

        if (!confirmation) {
            if (actionContext) actionContext.telemetry.properties.result = 'Canceled';
            return undefined;
        }

        // After confirmation, complete the cross-partition move independently of webview request cancellation.
        const result = await createDocument(connection, documentContent, undefined, state.partitionKeyDefinition);
        if (!result) {
            throw new Error(l10n.t('Item update with partition key change failed'));
        }

        try {
            await deletePartitionKeyMoveSource(connection, documentId, state.documentEtag);
        } catch {
            state.pendingPartitionKeyCleanup = {
                sourceIdentifier: documentId,
                sourceEtag: state.documentEtag,
                destination: result,
            };
            return {
                success: false,
                cleanupRequired: true,
                message: getPartitionKeyCleanupRequiredMessage(),
            } as const;
        }

        completePartitionKeyMove(ctx, result);
        return result;
    } else {
        // Simple replace
        if (actionContext) actionContext.telemetry.properties.partitionKeyChanged = 'false';

        let result: DocumentWriteResult | undefined;
        try {
            result = await replaceDocument(
                connection,
                documentContent,
                documentId,
                ctx.signal,
                state.partitionKeyDefinition,
                state.documentEtag,
            );
        } catch (error) {
            if (!isPreconditionFailed(error)) {
                throw error;
            }

            const currentDocument = await readDocument(
                connection,
                documentId,
                ctx.signal,
                state.partitionKeyDefinition,
            );
            if (!currentDocument) {
                throw error;
            }

            const resolution = await promptForDocumentConflict();
            if (resolution === 'discard') {
                updateLoadedDocumentState(state, currentDocument);
                return { discarded: true, ...currentDocument } as const;
            }
            if (resolution !== 'overwrite') {
                return { success: false, aborted: true } as const;
            }

            state.documentEtag = currentDocument.documentContent._etag;
            result = await replaceDocument(
                connection,
                documentContent,
                documentId,
                ctx.signal,
                state.partitionKeyDefinition,
                state.documentEtag,
            );
        }
        if (!result) {
            throw new Error(l10n.t('Failed to update item'));
        }

        if (result.partitionKey) state.partitionKeyDefinition = result.partitionKey;
        state.documentId = result.identifier;
        state.documentEtag = result.documentContent._etag;
        ctx.panel.title = `${result.identifier.id}.json`;
        return result;
    }
}

async function deletePartitionKeyMoveSource(
    connection: NoSqlQueryConnection,
    documentId: DocumentMutableState['documentId'] & {},
    expectedEtag?: string,
): Promise<void> {
    try {
        // Once creation succeeds, finish cleanup even if the originating webview request is canceled.
        const deleted = await deleteDocument(connection, documentId, undefined, expectedEtag);
        if (!deleted) {
            throw new Error('Item deletion did not complete');
        }
    } catch (error) {
        if (!isNotFound(error)) {
            throw error;
        }
    }
}

function completePartitionKeyMove(
    ctx: DocumentRouterContext,
    result: Awaited<ReturnType<typeof createDocument>> & {},
): void {
    if (result.partitionKey) ctx.state.partitionKeyDefinition = result.partitionKey;
    ctx.state.documentId = result.identifier;
    ctx.state.documentEtag = result.documentContent._etag;
    ctx.state.pendingPartitionKeyCleanup = undefined;
    ctx.panel.title = `${result.identifier.id}.json`;
}

function updateLoadedDocumentState(state: DocumentMutableState, document: DocumentResult): void {
    if (document.partitionKey) state.partitionKeyDefinition = document.partitionKey;
    state.documentEtag = document.documentContent._etag;
}

async function promptForDocumentConflict(): Promise<'overwrite' | 'discard' | undefined> {
    const overwriteItem: vscode.MessageItem = { title: l10n.t('Overwrite') };
    const discardItem: vscode.MessageItem = { title: l10n.t('Discard Changes and Refresh') };
    const message = l10n.t(
        'This item changed after it was opened. Overwrite the newer item with your changes, or discard your changes and refresh?',
    );
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, overwriteItem, discardItem);

    if (choice === overwriteItem) return 'overwrite';
    if (choice === discardItem) return 'discard';
    return undefined;
}

function getPartitionKeyCleanupRequiredMessage(): string {
    return l10n.t(
        'The item was created in the new partition, but the original item could not be deleted. Both items may exist.',
    );
}

function getPartitionKeyDestinationRefreshRequiredMessage(): string {
    return l10n.t(
        'Cleanup may have completed, but the item in the new partition could not be refreshed. Retry to load its latest state.',
    );
}

function getPartitionKeyRollbackRequiredMessage(): string {
    return l10n.t(
        'The partition key change could not be discarded because the item in the new partition has changed. Both items still exist. Resolve the duplicate items before retrying.',
    );
}

function cleanupRequiredResult(message: string = getPartitionKeyCleanupRequiredMessage()) {
    return {
        success: false,
        cleanupRequired: true,
        message,
    } as const;
}

function isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const candidate = error as { statusCode?: number; code?: string | number };
    return (
        candidate.statusCode === 404 ||
        candidate.code === 404 ||
        candidate.code === 'NotFound' ||
        candidate.code === 'ResourceNotFound'
    );
}

function isPreconditionFailed(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const candidate = error as { statusCode?: string | number; code?: string | number };
    return (
        candidate.statusCode === 412 ||
        candidate.statusCode === '412' ||
        candidate.code === 412 ||
        candidate.code === '412' ||
        candidate.code === 'PreconditionFailed'
    );
}

/**
 * Fire-and-forget schema refresh after a successful document creation.
 *
 * - Only runs when a schema already exists for this container (so we never
 *   start tracking a schema implicitly here).
 * - Respects the cosmosDB.queryEditor.generateSchemaBasedOnQueries setting.
 * - Webview refresh fan-out is owned by `SchemaService.onSchemaChanged` —
 *   QueryEditorTab subscribes once and re-renders Monaco autocomplete
 *   whenever a matching connection's schema changes.
 */
async function refreshSchemaForNewDocument(connection: NoSqlQueryConnection, documentContent: unknown): Promise<void> {
    try {
        const service = SchemaService.getInstance();
        if (!service.getMetadata(connection)) {
            return;
        }

        const updateFromQueriesEnabled = vscode.workspace
            .getConfiguration('cosmosDB.queryEditor')
            .get<boolean>('generateSchemaBasedOnQueries', false);

        await service.mergeDocumentsIntoSchema(connection, [documentContent as NoSQLDocument], {
            source: 'documentWrite',
            suppressNotification: true,
            confirmAll: true,
            updateFromQueriesEnabled,
        });
    } catch {
        // Best-effort: never let schema refresh break document creation.
    }
}
