/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createBlankContainer, withDerivedCandidates } from './dataModel';
import { createInitialSnapshot, useModelingAdvisorPersistence } from './modelingAdvisorState';
import { nextId } from './scenarios';

function savedSnapshot() {
    const state = createInitialSnapshot();
    const container = createBlankContainer('Saved');
    container.scale.candidates[0].distinctValues = 712;
    state.wizard = {
        ...state.wizard,
        step: 2,
        scenario: 'other',
        dataModel: { containers: [container], activeContainerId: container.id },
    };
    return state;
}

describe('modeling advisor persistence', () => {
    it('waits for a decision without writing defaults and restores only when continuing', async () => {
        const saved = savedSnapshot();
        const load = vi.fn().mockResolvedValue(saved);
        const save = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useModelingAdvisorPersistence({ load, save }));
        expect(result.current.loadStatus).toBe('loading');
        await waitFor(() => expect(result.current.loadStatus).toBe('choice'));
        expect(result.current.snapshot).toEqual(createInitialSnapshot());
        expect(save).not.toHaveBeenCalled();
        act(() => result.current.continueExisting());
        expect(result.current.snapshot).toEqual(saved);
        expect(save).not.toHaveBeenCalled();
        act(() =>
            result.current.setSnapshot((previous) => ({
                ...previous,
                wizard: { ...previous.wizard, step: 3 },
            })),
        );
        await waitFor(() => expect(save).toHaveBeenCalledOnce());
        expect(save).toHaveBeenCalledWith({ ...saved, wizard: { ...saved.wizard, step: 3 } });
    });

    it('replaces saved work only after explicitly starting new', async () => {
        const load = vi.fn().mockResolvedValue(savedSnapshot());
        const save = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useModelingAdvisorPersistence({ load, save }));
        await waitFor(() => expect(result.current.loadStatus).toBe('choice'));
        expect(save).not.toHaveBeenCalled();
        act(() => result.current.startNew());
        await waitFor(() => expect(save).toHaveBeenCalledWith(createInitialSnapshot()));
    });

    it('starts fresh without a prompt or save when there is no existing project', async () => {
        const load = vi.fn().mockResolvedValue(null);
        const save = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useModelingAdvisorPersistence({ load, save }));
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        expect(save).not.toHaveBeenCalled();
    });

    it('blocks saving after a failed load and offers the saved model again after retry', async () => {
        const load = vi.fn().mockRejectedValueOnce(new Error('corrupt')).mockResolvedValue(savedSnapshot());
        const save = vi.fn().mockResolvedValue(undefined);
        const { result } = renderHook(() => useModelingAdvisorPersistence({ load, save }));
        await waitFor(() => expect(result.current.loadStatus).toBe('error'));
        act(() => result.current.setSnapshot(savedSnapshot()));
        expect(save).not.toHaveBeenCalled();
        act(() => result.current.retryLoad());
        await waitFor(() => expect(result.current.loadStatus).toBe('choice'));
        expect(save).not.toHaveBeenCalled();
    });

    it('reports failed saves and retries without reverting current inputs', async () => {
        const load = vi.fn().mockResolvedValue(null);
        const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
        const { result } = renderHook(() => useModelingAdvisorPersistence({ load, save }));
        await waitFor(() => expect(result.current.loadStatus).toBe('ready'));
        const state = savedSnapshot();
        act(() => result.current.setSnapshot(state));
        await waitFor(() => expect(result.current.saveFailed).toBe(true));
        act(() => result.current.retrySave());
        await waitFor(() => expect(result.current.saveFailed).toBe(false));
        expect(save).toHaveBeenLastCalledWith(state);
    });

    it('ignores a load that resolves after closing', async () => {
        let resolve!: (value: ReturnType<typeof savedSnapshot>) => void;
        const load = vi.fn(
            () =>
                new Promise<ReturnType<typeof savedSnapshot>>((done) => {
                    resolve = done;
                }),
        );
        const save = vi.fn().mockResolvedValue(undefined);
        const { unmount } = renderHook(() => useModelingAdvisorPersistence({ load, save }));
        unmount();
        await act(async () => {
            resolve(savedSnapshot());
        });
        expect(save).not.toHaveBeenCalled();
    });
});

describe('restored model edits', () => {
    it('preserves saved cardinality and uses collision-free IDs for new rows', () => {
        const model = savedSnapshot().wizard.dataModel;
        expect(withDerivedCandidates(model).containers[0].scale.candidates[0]).toEqual(
            model.containers[0].scale.candidates[0],
        );
        expect(nextId('prop')).toMatch(/^prop-[0-9a-f-]{36}$/);
        expect(new Set(Array.from({ length: 100 }, () => nextId('prop'))).size).toBe(100);
    });
});
