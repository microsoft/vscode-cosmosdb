/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { type AccountHealthResult, type ActiveAlertSummary } from '../../api/types';

interface HealthSignalsClient {
    accountOverview: {
        getAccountHealth: { query: () => Promise<AccountHealthResult> };
        getActiveAlertSummary: { query: () => Promise<ActiveAlertSummary> };
    };
}

export function useOverviewHealthSignals(client: HealthSignalsClient, onError: () => void) {
    const [account, setAccount] = useState<AccountHealthResult>();
    const [accountLoading, setAccountLoading] = useState(true);
    const [activeAlerts, setActiveAlerts] = useState<ActiveAlertSummary>();
    const [activeAlertsLoading, setActiveAlertsLoading] = useState(true);
    const [activeAlertsUnavailable, setActiveAlertsUnavailable] = useState(false);
    const accountRequestSeq = useRef(0);
    const alertsRequestSeq = useRef(0);
    const errorHandler = useRef(onError);
    useEffect(() => {
        errorHandler.current = onError;
    }, [onError]);

    const fetchAccount = useCallback(async () => {
        const requestId = ++accountRequestSeq.current;
        setAccountLoading(true);
        try {
            const result = await client.accountOverview.getAccountHealth.query();
            if (requestId === accountRequestSeq.current) {
                setAccount(result);
            }
            return true;
        } catch {
            if (requestId === accountRequestSeq.current) {
                setAccount(undefined);
                errorHandler.current();
            }
            return false;
        } finally {
            if (requestId === accountRequestSeq.current) {
                setAccountLoading(false);
            }
        }
    }, [client]);

    const fetchActiveAlerts = useCallback(async () => {
        const requestId = ++alertsRequestSeq.current;
        setActiveAlertsLoading(true);
        try {
            const result = await client.accountOverview.getActiveAlertSummary.query();
            if (requestId === alertsRequestSeq.current) {
                setActiveAlertsUnavailable(!result.available);
                // Failed checks cannot prove recovery. Retain the last known signals and mark them as stale.
                setActiveAlerts((previous) => (result.available || !previous ? result : previous));
            }
            return result.available || result.reason === 'unsupported';
        } catch {
            if (requestId === alertsRequestSeq.current) {
                setActiveAlertsUnavailable(true);
                errorHandler.current();
            }
            return false;
        } finally {
            if (requestId === alertsRequestSeq.current) {
                setActiveAlertsLoading(false);
            }
        }
    }, [client]);

    const refresh = useCallback(async () => {
        const outcomes = await Promise.allSettled([fetchAccount(), fetchActiveAlerts()]);
        return outcomes.every((outcome) => outcome.status === 'fulfilled' && outcome.value);
    }, [fetchAccount, fetchActiveAlerts]);

    useEffect(() => {
        setAccount(undefined);
        setActiveAlerts(undefined);
        setActiveAlertsUnavailable(false);
        void refresh();
        return () => {
            // oxlint-disable-next-line react-hooks/exhaustive-deps -- Invalidate initial and manual reads.
            accountRequestSeq.current++;
            // oxlint-disable-next-line react-hooks/exhaustive-deps -- Invalidate initial and manual reads.
            alertsRequestSeq.current++;
        };
    }, [refresh]);

    return { account, accountLoading, activeAlerts, activeAlertsLoading, activeAlertsUnavailable, refresh };
}
