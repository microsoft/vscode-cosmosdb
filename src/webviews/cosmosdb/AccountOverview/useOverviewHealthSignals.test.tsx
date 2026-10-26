/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type AccountHealthResult, type ActiveAlertSummary } from '../../api/types';
import { useOverviewHealthSignals } from './useOverviewHealthSignals';

const healthy: AccountHealthResult = { available: true, health: 'Healthy', generatedAt: 1 };
const clear: ActiveAlertSummary = {
    available: true,
    totalCount: 0,
    criticalCount: 0,
    warningCount: 0,
    generatedAt: 1,
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

function createClient() {
    const account = vi.fn<() => Promise<AccountHealthResult>>().mockResolvedValue(healthy);
    const alerts = vi.fn<() => Promise<ActiveAlertSummary>>().mockResolvedValue(clear);
    return {
        account,
        alerts,
        client: {
            // tRPC can return a new nested proxy for each property access; the root is the stable dependency.
            get accountOverview() {
                return { getAccountHealth: { query: account }, getActiveAlertSummary: { query: alerts } };
            },
        },
    };
}

describe('useOverviewHealthSignals', () => {
    it('loads once and does not refetch on rerender or error-handler identity changes', async () => {
        const source = createClient();
        const { result, rerender } = renderHook(() => useOverviewHealthSignals(source.client, () => {}));
        await waitFor(() => expect(result.current.activeAlertsLoading || result.current.accountLoading).toBe(false));
        rerender();
        expect(result.current.account).toEqual(healthy);
        expect(result.current.activeAlerts).toEqual(clear);
        expect(source.account).toHaveBeenCalledTimes(1);
        expect(source.alerts).toHaveBeenCalledTimes(1);
    });

    it('waits for both refresh reads even after a transport failure and reports it once', async () => {
        const source = createClient();
        const onError = vi.fn();
        const { result } = renderHook(() => useOverviewHealthSignals(source.client, onError));
        await waitFor(() => expect(result.current.accountLoading).toBe(false));
        const pending = deferred<ActiveAlertSummary>();
        source.account.mockRejectedValueOnce(new Error('Monitor unavailable'));
        source.alerts.mockReturnValueOnce(pending.promise);
        let refresh!: Promise<boolean>;
        let settled = false;
        await act(async () => {
            refresh = result.current.refresh();
            void refresh.then(() => {
                settled = true;
            });
        });
        expect(settled).toBe(false);
        expect(result.current.account).toBeUndefined();
        expect(result.current.activeAlertsLoading).toBe(true);
        expect(onError).toHaveBeenCalledTimes(1);
        await act(async () => {
            pending.resolve(clear);
            expect(await refresh).toBe(false);
        });
        expect(result.current.activeAlertsLoading).toBe(false);
    });

    it('keeps earlier alert problems on unavailable and rejected checks, then accepts recovery', async () => {
        const source = createClient();
        const critical = { ...clear, totalCount: 1, criticalCount: 1 };
        source.alerts.mockResolvedValueOnce(critical);
        const onError = vi.fn();
        const { result } = renderHook(() => useOverviewHealthSignals(source.client, onError));
        await waitFor(() => expect(result.current.activeAlerts).toEqual(critical));
        source.alerts.mockResolvedValueOnce({ ...clear, available: false, reason: 'rbac' });
        await act(async () => {
            expect(await result.current.refresh()).toBe(false);
        });
        expect(result.current.activeAlerts).toEqual(critical);
        expect(result.current.activeAlertsUnavailable).toBe(true);
        expect(onError).not.toHaveBeenCalled();
        source.alerts.mockRejectedValueOnce(new Error('Transport failed'));
        await act(async () => {
            expect(await result.current.refresh()).toBe(false);
        });
        expect(result.current.activeAlerts).toEqual(critical);
        expect(onError).toHaveBeenCalledTimes(1);
        await act(async () => {
            expect(await result.current.refresh()).toBe(true);
        });
        expect(result.current.activeAlerts).toEqual(clear);
        expect(result.current.activeAlertsUnavailable).toBe(false);
    });

    it('ignores superseded initial responses and errors after a newer refresh', async () => {
        const source = createClient();
        const oldAccount = deferred<AccountHealthResult>();
        const oldAlerts = deferred<ActiveAlertSummary>();
        source.account.mockReturnValueOnce(oldAccount.promise);
        source.alerts.mockReturnValueOnce(oldAlerts.promise);
        const onError = vi.fn();
        const { result } = renderHook(() => useOverviewHealthSignals(source.client, onError));
        await act(async () => {
            expect(await result.current.refresh()).toBe(true);
        });
        await act(async () => {
            oldAccount.reject(new Error('Obsolete failure'));
            oldAlerts.resolve({ ...clear, totalCount: 1, criticalCount: 1 });
        });
        expect(result.current.account).toEqual(healthy);
        expect(result.current.activeAlerts).toEqual(clear);
        expect(result.current.accountLoading || result.current.activeAlertsLoading).toBe(false);
        expect(onError).not.toHaveBeenCalled();
    });

    it('clears retained evidence when the client changes and ignores old completion after unmount', async () => {
        const first = createClient();
        first.alerts.mockResolvedValueOnce({ ...clear, totalCount: 1, criticalCount: 1 });
        const onError = vi.fn();
        const { result, rerender, unmount } = renderHook(({ client }) => useOverviewHealthSignals(client, onError), {
            initialProps: { client: first.client },
        });
        await waitFor(() => expect(result.current.activeAlerts?.criticalCount).toBe(1));
        const second = createClient();
        const pendingAccount = deferred<AccountHealthResult>();
        const pendingAlerts = deferred<ActiveAlertSummary>();
        second.account.mockReturnValueOnce(pendingAccount.promise);
        second.alerts.mockReturnValueOnce(pendingAlerts.promise);
        rerender({ client: second.client });
        expect(result.current.activeAlerts).toBeUndefined();
        expect(result.current.account).toBeUndefined();
        expect(result.current.accountLoading && result.current.activeAlertsLoading).toBe(true);
        unmount();
        await act(async () => {
            pendingAccount.reject(new Error('Unmounted account'));
            pendingAlerts.reject(new Error('Unmounted alerts'));
        });
        expect(onError).not.toHaveBeenCalled();
    });
});
