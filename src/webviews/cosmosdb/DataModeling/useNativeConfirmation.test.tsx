/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeConfirmation } from './useNativeConfirmation';

const client = vi.hoisted(() => ({ dataModeling: { confirm: { mutate: vi.fn() } } }));
vi.mock('@microsoft/vscode-ext-webview/react', () => ({ useTrpcClient: () => client }));

describe('native modeler confirmations', () => {
    beforeEach(() => {
        client.dataModeling.confirm.mutate.mockReset();
    });

    it('ignores duplicate requests and responses after unmount', async () => {
        let answer!: (value: boolean) => void;
        client.dataModeling.confirm.mutate.mockImplementation(
            () =>
                new Promise<boolean>((resolve) => {
                    answer = resolve;
                }),
        );
        const { result, unmount } = renderHook(useNativeConfirmation);
        let pending!: Promise<boolean | undefined>;
        act(() => {
            pending = result.current.confirm('Remove?', 'Orders');
        });
        expect(result.current.confirming).toBe(true);
        expect(await result.current.confirm('Remove?', 'Orders')).toBeUndefined();
        expect(client.dataModeling.confirm.mutate).toHaveBeenCalledOnce();
        unmount();
        answer(true);
        expect(await pending).toBeUndefined();
    });

    it('reports failures and allows retry without approving the failed request', async () => {
        client.dataModeling.confirm.mutate.mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue(true);
        const { result } = renderHook(useNativeConfirmation);
        await act(async () => {
            expect(await result.current.confirm('Remove?', 'Orders')).toBeUndefined();
        });
        expect(result.current.confirmationError).toBe('Could not open the confirmation dialog. Please try again.');
        expect(result.current.confirming).toBe(false);
        await act(async () => {
            expect(await result.current.confirm('Remove?', 'Orders')).toBe(true);
        });
        expect(result.current.confirmationError).toBe('');
    });
});
