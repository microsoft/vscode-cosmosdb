/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This a minimal tRPC server
 */
import { z } from 'zod';
import { collectionsViewRouter as collectionViewRouter } from '../../mongoClusters/collectionView/collectionViewRouter';
import { documentsViewRouter as documentViewRouter } from '../../mongoClusters/documentView/documentsViewRouter';
import { publicProcedure, router } from '../extension-server/trpc';

/**
 * You can read more about tRPC here:
 * https://trpc.io/docs/quickstart
 *
 * This should be enough for you to catch up with this file.
 *
 * We're bundling routers here; each webview maintains its own router.
 * Here is where we bundle them all together.
 *
 * There is one router called 'commonRouter'. It has procedures that are shared across all webviews.
 */

const commonRouter = router({
    hello: publicProcedure
        // This is the input schema of your procedure, no parameters
        .query(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5000));

            // This is what you're returning to your client
            return { text: 'Hello World!' };
        }),
    sayMyName: publicProcedure
        // This is the input schema of your procedure, one parameter, a string
        .input(z.string())
        // Here the procedure (query or mutation)
        .query(async ({ input }) => {
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // This is what you're returning to your client
            return { text: `Hello ${input}!` };
        }),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const appRouter = router({
    common: commonRouter,
    mongoClusters: {
        documentView: documentViewRouter,
        collectionView: collectionViewRouter,
    },
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;
