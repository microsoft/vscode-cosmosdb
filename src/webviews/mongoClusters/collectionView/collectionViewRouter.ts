/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type JSONSchema } from 'vscode-json-languageservice';
import { z } from 'zod';
import { type MongoClustersClient } from '../../../mongoClusters/MongoClustersClient';
import { MongoClustersSession } from '../../../mongoClusters/MongoClusterSession';
import { getConfirmationWithWarning } from '../../../utils/dialogsConfirmations';
import { getKnownFields, type FieldEntry } from '../../../utils/json/mongo/autocomplete/getKnownFields';
import { publicProcedure, router } from '../../api/extension-server/trpc';

// eslint-disable-next-line import/no-internal-modules
import basicFindQuerySchema from '../../../utils/json/mongo/autocomplete/basicMongoFindFilterSchema.json';
import { generateMongoFindJsonSchema } from '../../../utils/json/mongo/autocomplete/generateMongoFindJsonSchema';

export type RouterContext = {
    sessionId: string;
    databaseName: string;
    collectionName: string;
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

            // const result = {
            // jsonDocuments: responsePack.jsonDocuments ?? [],
            // tableHeaders: responsePack.tableHeaders ?? [],
            // tableData: (responsePack.tableData as { 'x-objectid': string; [key: string]: unknown }[]) ?? [],
            // treeData: responsePack.treeData ?? [],
            // };

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

            vscode.commands.executeCommand('mongoClusters.internal.documentView.open', {
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

            vscode.commands.executeCommand('mongoClusters.internal.documentView.open', {
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

            vscode.commands.executeCommand('mongoClusters.internal.documentView.open', {
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

            const confirmed = await getConfirmationWithWarning(
                'Are you sure?',
                `Delete ${input.length} documents?\n\nThis can't be undone.`,
            );

            if (!confirmed) {
                return false;
            }

            const client: MongoClustersClient = MongoClustersSession.getSession(myCtx.sessionId).getClient();

            const acknowledged = await client.deleteDocuments(myCtx.databaseName, myCtx.collectionName, input);

            if (!acknowledged) {
                void vscode.window.showErrorMessage('Failed to delete documents. Unknown error.', {
                    modal: true,
                });
            }

            return acknowledged;
        }),
});
