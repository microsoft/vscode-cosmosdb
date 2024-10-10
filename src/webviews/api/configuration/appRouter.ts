/**
 * This a minimal tRPC server
 */
import { z } from 'zod';
import { publicProcedure, router } from '../extension-server/trpc';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const appRouter = router({
    bighello: publicProcedure
            // This is the input schema of your procedure, no parameters
            .query(async () => {
                await new Promise((resolve) => setTimeout(resolve, 5000));

                // This is what you're returning to your client
                return { text: 'helloWorld' };
            }),
    common: {
        hello: publicProcedure
            // This is the input schema of your procedure, no parameters
            .query(async () => {
                await new Promise((resolve) => setTimeout(resolve, 5000));

                // This is what you're returning to your client
                return { text: 'helloWorld' };
            }),
        sayMyName: publicProcedure
            // This is the input schema of your procedure, one parameter, a string
            .input(z.string())
            .query(async ({ input }) => {
                await new Promise((resolve) => setTimeout(resolve, 3000));

                // This is what you're returning to your client
                return { text: `Hello ${input}!` };
            }),
        doSomething: publicProcedure
        .mutation(() => {
            // This is what you're returning to your client
           console.log('Got activated from the client.');
        }),
    },
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;
