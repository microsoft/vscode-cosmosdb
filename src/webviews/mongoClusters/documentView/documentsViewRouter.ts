import { publicProcedure, router } from '../../api/extension-server/trpc';

export type RouterContext = {
    liveConnectionId: string;
    databaseName: string;
    collectionName: string;
}

export const documentsViewRouter = router({
    getInfo: publicProcedure.query(({ ctx }) => {
        const myCtx = ctx as RouterContext;

        return 'Info from webview B + ' + myCtx.liveConnectionId;
    }),
});
