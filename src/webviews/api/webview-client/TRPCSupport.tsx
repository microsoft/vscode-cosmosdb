/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import * as React from 'react';
import { TrpcClientSide } from './TrpcClientSide';

export function TRPCSupport({ children }: { children: React.ReactNode }) {
    const [queryClient] = React.useState(() => new QueryClient());
    const [trpcClient] = React.useState(() =>
        TrpcClientSide.createClient({
            links: [
                httpBatchLink({
                    url: 'http://localhost:3333/trpc',
                }),
            ],
        }),
    );
    return (
        <TrpcClientSide.Provider client={trpcClient} queryClient={queryClient}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </TrpcClientSide.Provider>
    );
}
