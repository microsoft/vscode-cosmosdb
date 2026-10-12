/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import { useEffect, useState } from 'react';
import { type AccountOverviewAppRouter, type AccountOverviewNavigation } from '../../api/types';

export function useOverviewNavigation() {
    const client = useTrpcClient<AccountOverviewAppRouter>();
    const [navigation, setNavigation] = useState<AccountOverviewNavigation>();
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        setFailed(false);
        const subscription = client.accountOverview.navigation.subscribe(undefined, {
            onData: (next) => {
                if (active) {
                    setNavigation((previous) => (previous && previous.revision > next.revision ? previous : next));
                    setFailed(false);
                }
            },
            onError: () => {
                if (active) {
                    setFailed(true);
                }
            },
        });
        return () => {
            active = false;
            subscription.unsubscribe();
        };
    }, [client, attempt]);

    return { navigation, failed, retry: () => setAttempt((value) => value + 1) };
}
