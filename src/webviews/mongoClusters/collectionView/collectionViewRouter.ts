/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { z } from 'zod';
import { type MongoClustersClient } from '../../../mongoClusters/MongoClustersClient';
import { MongoClustersSession } from '../../../mongoClusters/MongoClusterSession';
import { getConfirmationWithWarning } from '../../../utils/dialogsConfirmations';
import { publicProcedure, router } from '../../api/extension-server/trpc';

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
            const client: MongoClustersClient = MongoClustersSession.getSession(myCtx.sessionId).getClient();
            const responsePack = await client.runQuery(
                myCtx.databaseName,
                myCtx.collectionName,
                input.findQuery,
                input.pageNumber,
                input.pageSize,
            );

            const result = {
                jsonDocuments: responsePack.jsonDocuments ?? [],
                tableHeaders: responsePack.tableHeaders ?? [],
                tableData: (responsePack.tableData as { 'x-objectid': string; [key: string]: unknown }[]) ?? [],
                treeData: responsePack.treeData ?? [],
            };

            return result;
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
