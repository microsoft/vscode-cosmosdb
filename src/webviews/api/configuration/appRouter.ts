/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This a minimal tRPC server
 */
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { z } from 'zod';
import { type API } from '../../../AzureDBExperiences';
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

export type BaseRouterContext = {
    dbExperience: API;
    webviewName: string;
};

/**
 * eventName: string,
        properties?: Record<string, string>,
        measurements?: Record<string, number>
 */
const commonRouter = router({
    reportEvent: publicProcedure
        // This is the input schema of your procedure, two parameters, both strings
        .input(
            z.object({
                eventName: z.string(),
                properties: z.optional(z.record(z.string())), //By default, the keys of a JavaScript object are always strings (or symbols). Even if you use a number as an object key, JavaScript will convert it to a string internally.
                measurements: z.optional(z.record(z.number())), //By default, the keys of a JavaScript object are always strings (or symbols). Even if you use a number as an object key, JavaScript will convert it to a string internally.
            }),
        )
        // Here the procedure (query or mutation)
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as BaseRouterContext;

            void callWithTelemetryAndErrorHandling<void>(
                `cosmosDB.${myCtx.dbExperience}.webview.event.${myCtx.webviewName}.${input.eventName}`,
                (context) => {
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.properties.experience = myCtx.dbExperience;
                    Object.assign(context.telemetry.properties, input.properties ?? {});
                    Object.assign(context.telemetry.measurements, input.measurements ?? {});
                },
            );
        }),
    reportError: publicProcedure
        // This is the input schema of your procedure, two parameters, both strings
        .input(
            z.object({
                message: z.string(),
                stack: z.string(),
                componentStack: z.optional(z.string()),
                properties: z.optional(z.record(z.string())), //By default, the keys of a JavaScript object are always strings (or symbols). Even if you use a number as an object key, JavaScript will convert it to a string internally.
            }),
        )
        // Here the procedure (query or mutation)
        .mutation(({ input, ctx }) => {
            const myCtx = ctx as BaseRouterContext;

            void callWithTelemetryAndErrorHandling<void>(
                `cosmosDB.${myCtx.dbExperience}.webview.error.${myCtx.webviewName}`,
                (context) => {
                    context.errorHandling.suppressDisplay = true;
                    context.telemetry.properties.experience = myCtx.dbExperience;

                    Object.assign(context.telemetry.properties, input.properties ?? {});

                    const newError = new Error(input.message);
                    // If it's a rendering error in the webview, swap the stack with the componentStack which is more helpful
                    newError.stack = input.componentStack ?? input.stack;
                    throw newError;
                },
            );
        }),
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
