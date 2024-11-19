/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type JSONSchema } from 'vscode-json-languageservice';
import { z } from 'zod';
import { type MongoClustersClient } from '../../../mongoClusters/MongoClustersClient';
import { MongoClustersSession } from '../../../mongoClusters/MongoClusterSession';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { getKnownFields, type FieldEntry } from '../../../utils/json/mongo/autocomplete/getKnownFields';
import { publicProcedure, router } from '../../api/extension-server/trpc';

import { type CollectionItem } from '../../../mongoClusters/tree/CollectionItem';
// eslint-disable-next-line import/no-internal-modules
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import basicFindQuerySchema from '../../../utils/json/mongo/autocomplete/basicMongoFindFilterSchema.json';
import { generateMongoFindJsonSchema } from '../../../utils/json/mongo/autocomplete/generateMongoFindJsonSchema';
import { localize } from '../../../utils/localize';

export type RouterContext = {
    sessionId: string;
    databaseName: string;
    collectionName: string;
    collectionTreeItem: CollectionItem; // needed to execute commands on the collection as the tree APIv2 doesn't support id-based search for tree items.
};

export const collectionsViewRouter = router({
    getInfo: publicProcedure.query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return 'Info from the webview: ' + JSON.stringify(myCtx);
    }),
    runQuery: publicProcedure
        // parameters
        .input(
            z.object({
                findQuery: z.string(),
                pageNumber: z.number(),
                pageSize: z.number(),
            }),
        )
        // procedure type
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            // run query
            const session: MongoClustersSession = MongoClustersSession.getSession(myCtx.sessionId);
            const size = await session.runQueryWithCache(
                myCtx.databaseName,
                myCtx.collectionName,
                input.findQuery,
                input.pageNumber,
                input.pageSize,
            );

            return { documentCount: size };
        }),
    getAutocompletionSchema: publicProcedure
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: MongoClustersSession = MongoClustersSession.getSession(myCtx.sessionId);

            const _currentJsonSchema = session.getCurrentSchema();
            const autoCompletionData: FieldEntry[] = getKnownFields(_currentJsonSchema);

            let querySchema: JSONSchema;

            if (autoCompletionData.length > 0) {
                querySchema = generateMongoFindJsonSchema(autoCompletionData);
            } else {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                querySchema = basicFindQuerySchema;
            }

            return querySchema;
        }),
    getCurrentPageAsTable: publicProcedure
        //parameters
        .input(z.array(z.string()))
        // procedure type
        .query(({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: MongoClustersSession = MongoClustersSession.getSession(myCtx.sessionId);
            const tableData = session.getCurrentPageAsTable(input);

            return tableData;
        }),
    getCurrentPageAsTree: publicProcedure
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: MongoClustersSession = MongoClustersSession.getSession(myCtx.sessionId);
            const treeData = session.getCurrentPageAsTree();

            return treeData;
        }),
    getCurrentPageAsJson: publicProcedure
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: MongoClustersSession = MongoClustersSession.getSession(myCtx.sessionId);
            const jsonData = session.getCurrentPageAsJson();

            return jsonData;
        }),
    addDocument: publicProcedure
        // procedure type
        .mutation(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('command.internal.mongoClusters.documentView.open', {
                sessionId: myCtx.sessionId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                mode: 'add',
            });
        }),
    viewDocumentById: publicProcedure
        // parameters
        .input(z.string())
        // procedure type
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('command.internal.mongoClusters.documentView.open', {
                sessionId: myCtx.sessionId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                documentId: input,
                mode: 'view',
            });
        }),
    editDocumentById: publicProcedure
        // parameters
        .input(z.string())
        // procedure type
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('command.internal.mongoClusters.documentView.open', {
                sessionId: myCtx.sessionId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                documentId: input,
                mode: 'edit',
            });
        }),
    deleteDocumentsById: publicProcedure
        // parameteres
        .input(z.array(z.string())) // stands for string[]
        // procedure type
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            const confirmed = await getConfirmationAsInSettings(
                'Are you sure?',
                `Delete ${input.length} documents?\n\nThis can't be undone.`,
                'delete',
            );

            if (!confirmed) {
                return false;
            }

            const client: MongoClustersClient = MongoClustersSession.getSession(myCtx.sessionId).getClient();

            const acknowledged = await client.deleteDocuments(myCtx.databaseName, myCtx.collectionName, input);

            if (acknowledged) {
                showConfirmationAsInSettings(
                    input.length > 1
                        ? localize(
                              'showConfirmation.deletedNdocuments',
                              '{0} documents have been deleted.',
                              input.length,
                          )
                        : localize(
                              'showConfirmation.deletedNdocuments',
                              '{0} document has been deleted.',
                              input.length,
                          ),
                );
            }

            if (!acknowledged) {
                void vscode.window.showErrorMessage('Failed to delete documents. Unknown error.', {
                    modal: true,
                });
            }

            return acknowledged;
        }),
    exportDocuments: publicProcedure
        // parameters
        .input(z.object({ query: z.string() }))
        //procedure type
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand(
                'command.internal.mongoClusters.exportDocuments',
                myCtx.collectionTreeItem,
                input.query,
            );
        }),
    importDocuments: publicProcedure.query(async ({ ctx }) => {
        const myCtx = ctx as RouterContext;

        vscode.commands.executeCommand('command.internal.mongoClusters.importDocuments', myCtx.collectionTreeItem);
    }),
});
