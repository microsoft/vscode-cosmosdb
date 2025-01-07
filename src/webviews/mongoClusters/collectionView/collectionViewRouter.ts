/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type JSONSchema } from 'vscode-json-languageservice';
import { z } from 'zod';
import { MongoClustersSession } from '../../../mongoClusters/MongoClusterSession';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { getKnownFields, type FieldEntry } from '../../../utils/json/mongo/autocomplete/getKnownFields';
import { publicProcedure, router, trpcToTelemetry } from '../../api/extension-server/trpc';

import { type CollectionItem } from '../../../mongoClusters/tree/CollectionItem';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
// eslint-disable-next-line import/no-internal-modules
import basicFindQuerySchema from '../../../utils/json/mongo/autocomplete/basicMongoFindFilterSchema.json';
import { generateMongoFindJsonSchema } from '../../../utils/json/mongo/autocomplete/generateMongoFindJsonSchema';
import { localize } from '../../../utils/localize';
import { type BaseRouterContext } from '../../api/configuration/appRouter';

export type RouterContext = BaseRouterContext & {
    sessionId: string;
    clusterId: string;
    databaseName: string;
    collectionName: string;
    collectionTreeItem: CollectionItem; // needed to execute commands on the collection as the tree APIv2 doesn't support id-based search for tree items.
};

export const collectionsViewRouter = router({
    getInfo: publicProcedure.use(trpcToTelemetry).query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return 'Info from the webview: ' + JSON.stringify(myCtx);
    }),
    runQuery: publicProcedure
        .use(trpcToTelemetry)
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
        .use(trpcToTelemetry)
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
        .use(trpcToTelemetry)
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
        .use(trpcToTelemetry)
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: MongoClustersSession = MongoClustersSession.getSession(myCtx.sessionId);
            const treeData = session.getCurrentPageAsTree();

            return treeData;
        }),
    getCurrentPageAsJson: publicProcedure
        .use(trpcToTelemetry)
        // procedure type
        .query(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            const session: MongoClustersSession = MongoClustersSession.getSession(myCtx.sessionId);
            const jsonData = session.getCurrentPageAsJson();

            return jsonData;
        }),
    addDocument: publicProcedure
        .use(trpcToTelemetry)
        // procedure type
        .mutation(({ ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('command.internal.mongoClusters.documentView.open', {
                clusterId: myCtx.clusterId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                mode: 'add',
            });
        }),
    viewDocumentById: publicProcedure
        .use(trpcToTelemetry)
        // parameters
        .input(z.string())
        // procedure type
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('command.internal.mongoClusters.documentView.open', {
                clusterId: myCtx.clusterId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                documentId: input,
                mode: 'view',
            });
        }),
    editDocumentById: publicProcedure
        .use(trpcToTelemetry)
        // parameters
        .input(z.string())
        // procedure type
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('command.internal.mongoClusters.documentView.open', {
                clusterId: myCtx.clusterId,
                databaseName: myCtx.databaseName,
                collectionName: myCtx.collectionName,
                documentId: input,
                mode: 'edit',
            });
        }),
    deleteDocumentsById: publicProcedure
        .use(trpcToTelemetry)
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

            const session: MongoClustersSession = MongoClustersSession.getSession(myCtx.sessionId);
            const acknowledged = await session.deleteDocuments(myCtx.databaseName, myCtx.collectionName, input);

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
            } else {
                void vscode.window.showErrorMessage('Failed to delete documents. Unknown error.', {
                    modal: true,
                });
            }

            return acknowledged;
        }),
    exportDocuments: publicProcedure
        .use(trpcToTelemetry)
        // parameters
        .input(z.object({ query: z.string() }))
        //procedure type
        .query(({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            vscode.commands.executeCommand('command.internal.mongoClusters.exportDocuments', myCtx.collectionTreeItem, {
                queryText: input.query,
                source: 'webview;collectionView',
            });
        }),
    importDocuments: publicProcedure.use(trpcToTelemetry).query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        vscode.commands.executeCommand('command.mongoClusters.importDocuments', myCtx.collectionTreeItem, null, {
            source: 'webview;collectionView',
        });
    }),
});
