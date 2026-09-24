/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import { type inferRouterOutputs } from '@trpc/server';
import { useEffect, useRef, useState } from 'react';
import { type AccountOverviewAppRouter } from '../../api/types';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';

type AnalyticsResult = inferRouterOutputs<AccountOverviewAppRouter>['accountOverview']['getOverviewAnalytics'];

export type OverviewAnalyticsState = {
    data?: AnalyticsResult;
    loading: boolean;
    failed: boolean;
};

/** Opt-in data follows the shared refresh generation rather than creating another polling loop. */
export function useOverviewAnalytics(
    enabled: boolean,
    overview: Pick<AccountOverviewState, 'timeRange' | 'selectedContainer' | 'refreshVersion'>,
): OverviewAnalyticsState {
    const client = useTrpcClient<AccountOverviewAppRouter>();
    const { timeRange, selectedContainer, refreshVersion } = overview;
    const databaseId = selectedContainer?.databaseId;
    const containerId = selectedContainer?.containerId;
    const key = JSON.stringify([timeRange, databaseId, containerId, refreshVersion]);
    const requestedKey = useRef<string | undefined>(undefined);
    const sequence = useRef(0);
    const [state, setState] = useState<OverviewAnalyticsState & { key: string }>({
        key: '',
        loading: false,
        failed: false,
    });

    useEffect(
        () => () => {
            sequence.current += 1;
            requestedKey.current = undefined;
        },
        [],
    );

    useEffect(() => {
        if (!enabled || requestedKey.current === key) {
            return;
        }
        requestedKey.current = key;
        const request = ++sequence.current;
        setState({ key, loading: true, failed: false });
        void client.accountOverview.getOverviewAnalytics.query({ timeRange, databaseId, containerId }).then(
            (data) => {
                if (request === sequence.current) {
                    setState({ key, data, loading: false, failed: false });
                }
            },
            () => {
                if (request === sequence.current) {
                    setState({ key, loading: false, failed: true });
                }
            },
        );
    }, [client, enabled, key, timeRange, databaseId, containerId]);

    return state.key === key ? state : { loading: enabled, failed: false };
}
