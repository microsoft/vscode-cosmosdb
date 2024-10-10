/**
 * This a minimal tRPC server
 */
// eslint-disable-next-line import/no-internal-modules
import { observable } from '@trpc/server/observable';
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
    // https://trpc.io/docs/server/subscriptions --> even more to read here..
    // https://trpc.io/docs/migrate-from-v10-to-v11 --> and here..
    // TODO: look into this: https://trpc.io/docs/server/subscriptions#tracked
    // Note to code maintainers, we tracked back from v11 approach as the API isn't yet stable
    // builting it on top of the v10 approach, that should be updated before updating to tRPC v12
    time: publicProcedure.subscription(() => {
        return observable<{ time: string }>((emit) => {
            const timer = setInterval(() => {
                emit.next({ time: new Date().toLocaleTimeString() });
            }, 2000);

            // Return a cleanup function when the subscription is stopped
            return () => {
                clearInterval(timer);
            };
        });
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
        doSomething: publicProcedure.mutation(() => {
            // This is what you're returning to your client
            console.log('Got activated from the client.');
        }),
    },
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;
