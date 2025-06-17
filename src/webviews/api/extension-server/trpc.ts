/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is your entry point to setup the root configuration for tRPC on the server.
 * - `initTRPC` should only be used once per app.
 * - We export only the functionality that we use so we can enforce which base procedures should be used
 *
 * Learn how to create protected base procedures and other things below:
 * @see https://trpc.io/docs/v11/router
 * @see https://trpc.io/docs/v11/procedures
 */

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { initTRPC } from '@trpc/server';

/**
 * Initialization of tRPC backend.
 *
 * Please note, this hould be done only once per backend.
 */
const t = initTRPC.create();

/**
 * Unprotected procedure
 **/

export const createCallerFactory = t.createCallerFactory;

export const router = t.router;
export const publicProcedure = t.procedure;

// Create middleware for logging requests
export const trpcToTelemetry = t.middleware(async ({ path, type, next }) => {
    const result = await callWithTelemetryAndErrorHandling(`cosmosDB.rpc.${type}.${path}`, async (context) => {
        context.errorHandling.suppressDisplay = true;

        const result = await next();

        if (!result.ok) {
            /**
             * we're not handling any error here as we just want to log it here and let the
             * caller of the RPC call handle the error there.
             */

            context.telemetry.properties.result = 'Failed';
            context.telemetry.properties.error = result.error.name;
            context.telemetry.properties.errorMessage = result.error.message;
            context.telemetry.properties.errorStack = result.error.stack;
            if (result.error.cause) {
                context.telemetry.properties.errorCause = JSON.stringify(result.error.cause, null, 0);
            }
        }

        return result;
    });

    if (!result) {
        // This should never happen, but TypeScript requires us to handle the case where result is undefined.
        throw new Error(`No result returned from tRPC call for ${type} ${path}`);
    }

    return result;
});
