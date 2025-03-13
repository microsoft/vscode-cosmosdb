
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { publicProcedure, router, trpcToTelemetry } from '../../api/extension-server/trpc';

// eslint-disable-next-line import/no-internal-modules
import { z } from 'zod';
import { type BaseRouterContext } from '../../api/configuration/appRouter';

/**
 * Information shared during the life time of the webview
 */
export type RouterContext = BaseRouterContext & {
    databaseName: string;
};

export const assessmentWizardViewRouter = router({
    getInfo: publicProcedure.use(trpcToTelemetry).query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return 'Info from the webview: ' + JSON.stringify(myCtx);
    }),
    getDatabaseName: publicProcedure.use(trpcToTelemetry).query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return myCtx.databaseName;
    }),
    hello: publicProcedure
        .use(trpcToTelemetry)
        // This is the input schema of your procedure, no parameters
        .query(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5000));

            // This is what you're returning to your client
            return { text: 'Hello World!' };
        }),
    sayMyName: publicProcedure
        .use(trpcToTelemetry)
        // This is the input schema of your procedure, one parameter, a string
        .input(z.string())
        // Here the procedure (query or mutation)
        .query(async ({ input, ctx }) => {
            const myCtx = ctx as RouterContext;

            if (input === 'error') {
                throw new Error('An error occurred, but you have asked for it :)');
            }

            // This is what you're returning to your client
            return { text: `Hello ${input}! (webview name: ${myCtx.webviewName})` };
        }),
});
