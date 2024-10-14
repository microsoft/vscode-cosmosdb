import { z } from 'zod';
import { MongoClustersClient } from '../../../mongoClusters/MongoClustersClient';
import { publicProcedure, router } from '../../api/extension-server/trpc';

export type RouterContext = {
    liveConnectionId: string;
    databaseName: string;
    collectionName: string;
    documentId: string;

    viewPanelTitleSetter: (title: string) => void;
};

export const documentsViewRouter = router({
    getInfo: publicProcedure.query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return 'Info from the webview: ' + JSON.stringify(myCtx);
    }),
    getDocumentById: publicProcedure
        // parameters
        .input(z.string())
        // procedure type
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            // run query
            const client: MongoClustersClient = await MongoClustersClient.getClient(myCtx.liveConnectionId);
            const documentContent = await client.pointRead(myCtx.databaseName, myCtx.collectionName, input);

            const documentContetntAsString = JSON.stringify(documentContent, null, 4);

            return documentContetntAsString;
        }),
    saveDocument: publicProcedure
        // parameteres
        .input(z.object({ documentContent: z.string() }))
        // procedure type
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            const documentId = extractIdFromJson(input.documentContent) ?? '';

            // run query
            const client: MongoClustersClient = await MongoClustersClient.getClient(myCtx.liveConnectionId);

            // when a document is saved and is missing an _id field, the _id field is added on the server
            // or by the mongodb driver.
            const upsertResult = await client.upsertDocument(
                myCtx.databaseName,
                myCtx.collectionName,
                documentId,
                input.documentContent,
            );

            // extract the _id field from the document
            const objectId = upsertResult.documentId.toString();
            const newDocumentContetntAsString = JSON.stringify(upsertResult.documentContent, null, 4);

            myCtx.viewPanelTitleSetter(`${myCtx.databaseName}/${myCtx.collectionName}/${objectId}`);

            return { documentContent: newDocumentContetntAsString, documentId: objectId };
        }),
});

function extractIdFromJson(jsonString: string): string | null {
    let extractedId: string | null = null;

    // Use JSON.parse with a reviver function
    JSON.parse(jsonString, (key, value) => {
        if (key === '_id') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            extractedId = value; // Extract _id when found
        }
        // Return the value to keep parsing
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return value;
    });

    return extractedId;
}
