/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { EJSON } from 'bson';
import { type Document } from 'mongodb';
import { z } from 'zod';
import { MongoClustersClient } from '../../../documentdb/MongoClustersClient';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { promptAfterActionEventually } from '../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../utils/surveyTypes';
import { type BaseRouterContext } from '../../api/configuration/appRouter';
import { publicProcedure, router, trpcToTelemetry } from '../../api/extension-server/trpc';

export type RouterContext = BaseRouterContext & {
    clusterId: string;
    databaseName: string;
    collectionName: string;
    documentId: string;

    viewPanelTitleSetter: (title: string) => void;
};

export const documentsViewRouter = router({
    getInfo: publicProcedure.query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return l10n.t('Info from the webview: ') + JSON.stringify(myCtx);
    }),
    getDocumentById: publicProcedure
        .use(trpcToTelemetry)
        // parameters
        .input(z.string())
        // procedure type
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            // run query
            const client: MongoClustersClient = await MongoClustersClient.getClient(myCtx.clusterId);
            const documentContent = await client.pointRead(myCtx.databaseName, myCtx.collectionName, input);

            /**
             * Please note, the document is a 'Document' object, which is a BSON object.
             * Not all BSON objects can be serialized to JSON. Therefore, we're using
             * EJSON to serialize the document to an object that can be serialized to JSON.
             */
            const extendedJson = EJSON.stringify(documentContent, undefined, 4);

            //const documentContetntAsString = JSON.stringify(extendedJson, null, 4);

            return extendedJson;
        }),
    saveDocument: publicProcedure
        .use(trpcToTelemetry)
        // parameteres
        .input(z.object({ documentContent: z.string() }))
        // procedure type
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            const documentBson: Document = EJSON.parse(input.documentContent);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let documentId: any;
            if (documentBson['_id']) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                documentId = documentBson['_id'];
            }

            // run query
            const client: MongoClustersClient = await MongoClustersClient.getClient(myCtx.clusterId);

            // when a document is saved and is missing an _id field, the _id field is added on the server
            // or by the mongodb driver.
            const upsertResult = await client.upsertDocument(
                myCtx.databaseName,
                myCtx.collectionName,
                documentId ? EJSON.stringify(documentId) : '',
                documentBson,
            );

            // extract the _id field from the document
            const newDocumentId = EJSON.stringify(upsertResult.documentId);

            /**
             * Please note, the document is a 'Document' object, which is a BSON object.
             * Not all BSON objects can be serialized to JSON. Therefore, we're using
             * EJSON to serialize the document to an object that can be serialized to JSON.
             */
            const extendedJson = EJSON.serialize(upsertResult.document);
            const newDocumentStringified = JSON.stringify(extendedJson, null, 4);

            myCtx.viewPanelTitleSetter(`${myCtx.databaseName}/${myCtx.collectionName}/${newDocumentId}`);

            showConfirmationAsInSettings(l10n.t('The document with the _id "{0}" has been saved.', newDocumentId));

            void promptAfterActionEventually(ExperienceKind.Mongo, UsageImpact.High);

            return { documentStringified: newDocumentStringified, documentId: newDocumentId };
        }),
});

// function extractIdFromJson(jsonString: string): string | null {
//     let extractedId: string | null = null;

//     // Use JSON.parse with a reviver function
//     JSON.parse(jsonString, (key, value) => {
//         if (key === '_id') {
//             // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
//             extractedId = value; // Extract _id when found
//         }
//         // Return the value to keep parsing
//         // eslint-disable-next-line @typescript-eslint/no-unsafe-return
//         return value;
//     });

//     return extractedId;
// }
