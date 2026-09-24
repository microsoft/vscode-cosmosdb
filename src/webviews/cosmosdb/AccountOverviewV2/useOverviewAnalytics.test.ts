/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { type AccountOverviewState } from '../AccountOverview/useAccountOverview';
import { useOverviewAnalytics } from './useOverviewAnalytics';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@microsoft/vscode-ext-webview/react', () => {
    const client = { accountOverview: { getOverviewAnalytics: { query } } };
    return { useTrpcClient: () => client };
});

type Props = Pick<AccountOverviewState, 'timeRange' | 'selectedContainer' | 'refreshVersion'> & { enabled: boolean };
const initial: Props = { enabled: false, timeRange: '24H', refreshVersion: 0, selectedContainer: undefined };

describe('opt-in overview analytics', () => {
    beforeEach(() => {
        query.mockReset().mockRejectedValue(new Error('Transport unavailable'));
    });

    it('does not fetch for Original, reuses a generation on switches, and retries on refresh', async () => {
        const { result, rerender } = renderHook((props: Props) => useOverviewAnalytics(props.enabled, props), {
            initialProps: initial,
        });
        expect(query).not.toHaveBeenCalled();
        await act(async () => rerender({ ...initial, enabled: true }));
        expect(query).toHaveBeenCalledTimes(1);
        expect(result.current).toMatchObject({ failed: true, loading: false });
        await act(async () => rerender(initial));
        await act(async () => rerender({ ...initial, enabled: true }));
        expect(query).toHaveBeenCalledTimes(1);
        await act(async () => rerender({ ...initial, enabled: true, refreshVersion: 1 }));
        expect(query).toHaveBeenCalledTimes(2);
    });

    it('does not let an older request failure overwrite the current scope', async () => {
        let rejectOld: ((reason: Error) => void) | undefined;
        let rejectNew: ((reason: Error) => void) | undefined;
        query
            .mockImplementationOnce(
                () =>
                    new Promise<never>((_, reject) => {
                        rejectOld = reject;
                    }),
            )
            .mockImplementationOnce(
                () =>
                    new Promise<never>((_, reject) => {
                        rejectNew = reject;
                    }),
            );
        const { result, rerender } = renderHook((props: Props) => useOverviewAnalytics(props.enabled, props), {
            initialProps: { ...initial, enabled: true },
        });
        await act(async () =>
            rerender({ ...initial, enabled: true, timeRange: '7D', selectedContainer: { databaseId: 'other' } }),
        );
        expect(query).toHaveBeenLastCalledWith({ timeRange: '7D', databaseId: 'other', containerId: undefined });
        await act(async () => rejectOld?.(new Error('Old failure')));
        expect(result.current).toMatchObject({ loading: true, failed: false });
        await act(async () => rejectNew?.(new Error('Current failure')));
        expect(result.current).toMatchObject({ loading: false, failed: true });
    });

    it('defers refreshes while Original is active and uses only the latest selection on return', async () => {
        const { rerender } = renderHook((props: Props) => useOverviewAnalytics(props.enabled, props), {
            initialProps: initial,
        });
        await act(async () => rerender({ ...initial, refreshVersion: 2, timeRange: '1H' }));
        expect(query).not.toHaveBeenCalled();
        await act(async () => rerender({ ...initial, enabled: true, refreshVersion: 2, timeRange: '1H' }));
        expect(query).toHaveBeenCalledExactlyOnceWith({
            timeRange: '1H',
            databaseId: undefined,
            containerId: undefined,
        });
    });
});
