/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useTrpcClient } from '@microsoft/vscode-ext-webview/react';
import { useCallback } from 'react';
import { type OverviewError, type OverviewEvent } from '../../../panels/accountOverview/telemetryContract';
import { type AccountOverviewAppRouter } from '../../api/types';

/** Best-effort bridge; no file contents, paths, or names are emitted. */
export function useOverviewTelemetry() {
    const client = useTrpcClient<AccountOverviewAppRouter>();
    const reportEvent = useCallback(
        (eventName: OverviewEvent['eventName'], properties?: OverviewEvent['properties']) => {
            void (async () => {
                try {
                    await client.accountOverview.reportEvent.mutate({ eventName, properties });
                } catch (error) {
                    console.error('Unable to report Account Overview telemetry.', error);
                }
            })();
        },
        [client],
    );
    const reportError = useCallback(
        (failure: OverviewError) => {
            void (async () => {
                try {
                    await client.accountOverview.reportError.mutate(failure);
                } catch (error) {
                    console.error('Unable to report Account Overview failure.', error);
                }
            })();
        },
        [client],
    );
    return { reportEvent, reportError };
}
