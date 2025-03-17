/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This a minimal tRPC server
 */
import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { z } from 'zod';
import { type API } from '../../../AzureDBExperiences';
import { openSurvey, promptAfterActionEventually } from '../../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../../utils/surveyTypes';
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
    signal?: AbortSignal; // This is a special property that is used to cancel subscriptions
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
    displayErrorMessage: publicProcedure
        .input(
            z.object({
                message: z.string(),
                modal: z.boolean(),
                cause: z.string(),
            }),
        )
        .mutation(({ input }) => {
            let message = input.message;
            if (input.cause && !input.modal) {
                message += ` (${input.cause})`;
            }

            void vscode.window.showErrorMessage(message, {
                modal: input.modal,
                detail: input.modal ? input.cause : undefined, // The content of the 'detail' field is only shown when modal is true
            });
        }),
    surveyPing: publicProcedure
        .input(
            z.object({
                experienceKind: z.nativeEnum(ExperienceKind),
                usageImpact: z.nativeEnum(UsageImpact),
            }),
        )
        .mutation(({ input }) => {
            void promptAfterActionEventually(input.experienceKind, input.usageImpact);
        }),
    surveyOpen: publicProcedure
        .input(
            z.object({
                experienceKind: z.nativeEnum(ExperienceKind),
                triggerAction: z.string(), // Optional action that triggered the survey for telemetry
            }),
        )
        .mutation(({ input }) => {
            void openSurvey(input.experienceKind, input.triggerAction);
        }),
});

// This is a demoRouter with examples of how to create a subscription
// We left it here for reference for future projects
//
// const demoRouter = router({
//     /**
//      * Example Subscription Procedure: `demoBasicSubscription`
//      *
//      * This subscription demonstrates how to stream data from the server to the client over time
//      * using asynchronous generators (the tRPC v11/v12 approach).
//      *
//      * **How Subscriptions Work in tRPC:**
//      * - A subscription procedure is defined using `publicProcedure.subscription(async function*(opts) { ... })`.
//      * - Inside the async generator, you `yield` values over time. Each yielded value is sent to the client.
//      * - The subscription remains active until one of the following occurs:
//      *   1. The server side returns from the async generator function (e.g., after certain logic or conditions).
//      *   2. An error is thrown inside the async generator, causing the subscription to terminate with an error.
//      *   3. The client unsubscribes (calling `subscription.unsubscribe()` on the client), which triggers the server to cancel the subscription.
//      *   4. The server receives an abort signal (such as `ctx.signal.aborted`), and you return early to stop emitting more values.
//      *
//      * **Context and Abort Signals:**
//      * - `ctx` contains an `AbortSignal` (`ctx.signal`) that indicates when the client wants to stop the subscription.
//      * - By checking `if (ctx.signal?.aborted)`, you can gracefully end the subscription. This ensures no further values are emitted.
//      *
//      * **Usage Example (on the Client):**
//      * ```typescript
//      * const subscription = trpcClient.demo.demoBasicSubscription.subscribe(undefined, {
//      *   onStarted() {
//      *     console.log('Subscription started');
//      *   },
//      *   onData(data) {
//      *     console.log('Received subscription data:', data);
//      *     if (data === 5) {
//      *       // Manually unsubscribe after receiving the number 5
//      *       subscription.unsubscribe();
//      *       // Note: onComplete() will not be called because we're forcefully unsubscribing here
//      *     }
//      *   },
//      *   onError(err) {
//      *     console.error('Subscription error:', err);
//      *   },
//      *   onComplete() {
//      *     console.log('Subscription completed');
//      *   }
//      * });
//      * ```
//      *
//      * **Key Points:**
//      * - Subscriptions can produce multiple values over time.
//      * - You decide when to stop by returning or by the client unsubscribing.
//      * - Error handling and completion are well-defined; the client receives these signals via callbacks.
//      */
//     demoBasicSubscription: publicProcedure.subscription(async function* ({ ctx }) {
//         const myCtx = ctx as BaseRouterContext;

//         let count = 0;
//         while (true) {
//             // Simulate work or data updates by delaying each emission
//             await new Promise((resolve) => setTimeout(resolve, 2000));

//             // Optionally, you can stop emitting values after a certain condition:
//             // if (count > 2) {
//             //     return; // This completes the subscription after three iterations (0, 1, 2)
//             // }

//             // Check if the client has aborted (unsubscribed) before yielding the next value
//             if (myCtx.signal?.aborted) {
//                 // If aborted, just return to end the subscription gracefully
//                 return;
//             }

//             // Yield the next value of `count`. This value is sent to the client as soon as possible.
//             yield count++;
//         }
//     }),
//     /**
//      * Example Subscription Procedure: `demoComplexSubscription`
//      *
//      * This subscription demonstrates handling more complex inputs and outputs compared to a simple counter.
//      *
//      * **Key Points:**
//      * - Inputs are validated using Zod, ensuring the caller provides the correct structure:
//      *   - `start` and `end`: define the numeric range of values to emit.
//      *   - `abortAt`: an optional number that, if reached or surpassed, causes the subscription to end.
//      * - Each emitted value is delayed to simulate work or streaming data updates.
//      * - The subscription checks both a user-defined cutoff (`abortAt`) and the `ctx.signal` abort
//      *   mechanism to decide when to stop.
//      * - Yielded data includes the current value, a `done` flag, and the original input, showing how
//      *   you can return rich, structured results at each emission.
//      *
//      * **Example Usage on the Client:**
//      * ```typescript
//      * const subscription = trpcClient.demo.demoComplexSubscription.subscribe(
//      *   { start: 1, end: 10, abortAt: 5 },
//      *   {
//      *     onStarted() {
//      *       console.log('Complex subscription started');
//      *     },
//      *     onData(data) {
//      *       console.log('Received complex subscription data:', data);
//      *     },
//      *     onError(err) {
//      *       console.error('Complex subscription error:', err);
//      *     },
//      *     onComplete() {
//      *       console.log('Complex subscription completed');
//      *     }
//      *   }
//      * );
//      * ```
//      *
//      * This setup shows how you can manage more intricate logic in a subscription:
//      * - Emitting a range of values.
//      * - Allowing the client to define when to stop via `abortAt`.
//      * - Handling external abort signals for graceful termination.
//      * - Returning additional contextual data (`originalInput`) along with each value.
//      */
//     demoComplexSubscription: publicProcedure
//         .use(trpcToTelemetry)
//         .input(
//             z.object({
//                 start: z.number(),
//                 end: z.number(),
//                 abortAt: z.optional(z.number()),
//             }),
//         )
//         .subscription(async function* ({ input, ctx }) {
//             const myCtx = ctx as BaseRouterContext;

//             for (let i = input.start; i <= input.end; i++) {
//                 // Simulate work or data updates by delaying each emission
//                 await new Promise((resolve) => setTimeout(resolve, 2000));

//                 if (input.abortAt && i >= input.abortAt) {
//                     // If the specified abortAt value is reached, stop emitting.
//                     return;
//                 }

//                 // Check if the client has aborted (unsubscribed) before yielding the next value
//                 if (myCtx.signal?.aborted) {
//                     // If aborted, just return to end the subscription gracefully
//                     return;
//                 }

//                 yield { value: i, done: false, originalInput: input };
//             }
//         }),
//     hello: publicProcedure
//         // This is the input schema of your procedure, no parameters
//         .query(async () => {
//             await new Promise((resolve) => setTimeout(resolve, 5000));

//             // This is what you're returning to your client
//             return { text: 'Hello World!' };
//         }),
//     sayMyName: publicProcedure
//         // This is the input schema of your procedure, one parameter, a string
//         .input(z.string())
//         // Here the procedure (query or mutation)
//         .query(async ({ input }) => {
//             // This is what you're returning to your client
//             return { text: `Hello ${input}!` };
//         }),
// });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const appRouter = router({
    common: commonRouter,
    // demo: demoRouter, // this is a demo-router and it's left for reference for future projects
    mongoClusters: {
        documentView: documentViewRouter,
        collectionView: collectionViewRouter,
    },
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;
