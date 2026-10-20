/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TypedEventSink } from '@microsoft/vscode-ext-webview';
import { type AccountOverviewNavigation } from '../../../accountOverview/navigation';
import { accountOverviewProcedure } from '../../trpc';

export const navigationProcedures = {
    navigation: accountOverviewProcedure.subscription(async function* ({ ctx }) {
        const sink = new TypedEventSink<AccountOverviewNavigation>();
        const subscription = ctx.onNavigation((navigation) => sink.emit(navigation));
        const close = () => sink.close();
        ctx.signal?.addEventListener('abort', close, { once: true });
        sink.emit(ctx.getInitialization());
        try {
            for await (const navigation of sink) {
                if (ctx.signal?.aborted) {
                    return;
                }
                yield navigation;
            }
        } finally {
            ctx.signal?.removeEventListener('abort', close);
            subscription.dispose();
            sink.close();
        }
    }),
};
