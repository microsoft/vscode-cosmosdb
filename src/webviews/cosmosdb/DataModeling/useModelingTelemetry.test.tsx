/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type ModelingTelemetryEvent } from '../../../dataModeling/modelingTelemetrySchema';
import { applyScenario, createInitialState } from './dataModel';
import { useModelingUsage } from './useModelingTelemetry';

function lastUsage(report: ReturnType<typeof vi.fn<(event: ModelingTelemetryEvent) => void>>) {
    const event = report.mock.calls.at(-1)?.[0];
    if (event?.type !== 'usage') throw new Error('Expected usage summary');
    return event.usage;
}

describe('modeling usage tracking', () => {
    it('distinguishes current defaults from edits that were reverted in this session', () => {
        const report = vi.fn<(event: ModelingTelemetryEvent) => void>();
        const defaults = applyScenario(createInitialState(), 'chat');
        const { result, rerender } = renderHook(({ wizard }) => useModelingUsage(wizard, report), {
            initialProps: { wizard: defaults },
        });
        expect(lastUsage(report)).toMatchObject({ differsFromDefault: false, everEdited: false });
        const edited = structuredClone(defaults);
        edited.dataModel.containers[0].reads[0].qps += 1;
        act(() => result.current.markEdited('queries'));
        rerender({ wizard: edited });
        expect(lastUsage(report)).toMatchObject({
            differsFromDefault: true,
            queriesChanged: true,
            queriesEverEdited: true,
            dataEverEdited: false,
        });
        rerender({ wizard: defaults });
        expect(lastUsage(report)).toMatchObject({
            differsFromDefault: false,
            queriesChanged: false,
            queriesEverEdited: true,
            everEdited: true,
        });
    });

    it('counts unique visits only for current containers, with no identifiers in output', () => {
        const report = vi.fn<(event: ModelingTelemetryEvent) => void>();
        const wizard = applyScenario(createInitialState(), 'chat');
        const { result, rerender } = renderHook(({ value }) => useModelingUsage(value, report), {
            initialProps: { value: wizard },
        });
        expect(lastUsage(report).dataViewedCount).toBe(0);
        const id = wizard.dataModel.containers[0].id;
        act(() => {
            result.current.visit(id, 'data');
            result.current.visit(id, 'queries');
            result.current.visit(id, 'queries');
        });
        expect(lastUsage(report)).toMatchObject({ dataViewedCount: 1, queriesViewedCount: 1, scaleViewedCount: 0 });
        expect(JSON.stringify(report.mock.calls)).not.toContain(id);
        const count = report.mock.calls.length;
        act(() => result.current.visit(id, 'queries'));
        expect(report).toHaveBeenCalledTimes(count);
        const next = applyScenario(createInitialState(), 'chat');
        rerender({ value: next });
        expect(lastUsage(report)).toMatchObject({ dataViewedCount: 0, queriesViewedCount: 0, scaleViewedCount: 0 });
    });
});
