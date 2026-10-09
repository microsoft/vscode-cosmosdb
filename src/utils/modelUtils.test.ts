/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { getAvailableModelsInfo, getSelectedModel, setE2eModelOverride } from './aiUtils';
import {
    formatTokenCount,
    getMigrationModels,
    MIGRATION_SELECTED_MODEL_KEY,
    partitionModelsByCapability,
    resolveSelectedModelId,
    sortModelsAutoFirst,
    type ModelInfo,
} from './modelUtils';

vi.mock('../extensionVariables', () => ({
    ext: { context: { globalState: { get: vi.fn(), update: vi.fn() } } },
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({ callWithTelemetryAndErrorHandling: vi.fn() }));
vi.mock('vscode', () => ({ lm: { selectChatModels: vi.fn() } }));

describe('migration model availability', () => {
    const models = [
        { id: 'auto', name: 'Auto', vendor: 'copilot', family: 'auto', maxInputTokens: 128_000 },
        { id: 'first', name: 'First', vendor: 'copilot', family: 'first', maxInputTokens: 100_000 },
        { id: 'second', name: 'Second', vendor: 'copilot', family: 'second', maxInputTokens: 200_000 },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        setE2eModelOverride(undefined);
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue(models as vscode.LanguageModelChat[]);
        vi.mocked(ext.context.globalState.get).mockReturnValue('auto');
    });

    afterEach(() => setE2eModelOverride(undefined));

    it('includes Auto only when explicitly requested without overwriting preferences', async () => {
        expect((await getAvailableModelsInfo()).models.map((model) => model.id)).toEqual(['first', 'second']);
        expect(await getAvailableModelsInfo(MIGRATION_SELECTED_MODEL_KEY, { includeAuto: true })).toEqual({
            models,
            savedModelId: 'auto',
        });
        expect(ext.context.globalState.update).not.toHaveBeenCalled();
    });

    it('resolves saved Auto to the first concrete model for direct migration requests', async () => {
        expect(await getSelectedModel({ stateKey: MIGRATION_SELECTED_MODEL_KEY, excludeAuto: true })).toBe(models[1]);
        expect(ext.context.globalState.get).toHaveBeenCalledWith(MIGRATION_SELECTED_MODEL_KEY);
        expect(ext.context.globalState.update).not.toHaveBeenCalled();
    });

    it('preserves a concrete preference', async () => {
        vi.mocked(ext.context.globalState.get).mockReturnValue('second');
        expect(await getSelectedModel({ excludeAuto: true })).toBe(models[2]);
    });

    it('rejects an Auto-only list for direct migration requests', async () => {
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([models[0]] as vscode.LanguageModelChat[]);
        await expect(getSelectedModel({ excludeAuto: true })).rejects.toThrow('No language models available');
    });

    it('applies the same availability filtering to E2E overrides', async () => {
        setE2eModelOverride(models);
        expect((await getAvailableModelsInfo()).models.map((model) => model.id)).toEqual(['first', 'second']);
        expect((await getAvailableModelsInfo(MIGRATION_SELECTED_MODEL_KEY, { includeAuto: true })).models).toEqual(
            models,
        );
    });
});

function makeModel(overrides: Partial<ModelInfo> & Pick<ModelInfo, 'id' | 'name' | 'maxInputTokens'>): ModelInfo {
    return {
        family: 'test-family',
        vendor: 'test-vendor',
        ...overrides,
    };
}

describe('formatTokenCount', () => {
    it('returns the raw number below 1000', () => {
        expect(formatTokenCount(0)).toBe('0');
        expect(formatTokenCount(1)).toBe('1');
        expect(formatTokenCount(999)).toBe('999');
    });

    it('formats thousands with a "k" suffix', () => {
        expect(formatTokenCount(1_000)).toBe('1k');
        expect(formatTokenCount(128_000)).toBe('128k');
        // Non-round thousands keep one decimal.
        expect(formatTokenCount(1_500)).toBe('1.5k');
        expect(formatTokenCount(8_192)).toBe('8.2k');
    });

    it('formats millions with an "M" suffix', () => {
        expect(formatTokenCount(1_000_000)).toBe('1M');
        expect(formatTokenCount(2_000_000)).toBe('2M');
        expect(formatTokenCount(1_500_000)).toBe('1.5M');
    });

    it('prefers the M suffix at exactly one million', () => {
        // 1_000_000 hits the millions branch, not the thousands branch.
        expect(formatTokenCount(1_000_000)).toBe('1M');
    });
});

describe('sortModelsAutoFirst', () => {
    it('moves the "Auto" model to the front (case-insensitive)', () => {
        const models = [
            makeModel({ id: 'a', name: 'Alpha', maxInputTokens: 1000 }),
            makeModel({ id: 'auto', name: 'auto', maxInputTokens: 2000 }),
            makeModel({ id: 'b', name: 'Beta', maxInputTokens: 3000 }),
        ];

        const sorted = sortModelsAutoFirst(models);

        expect(sorted.map((m) => m.id)).toEqual(['auto', 'a', 'b']);
    });

    it('preserves the relative order of non-auto models', () => {
        const models = [
            makeModel({ id: 'b', name: 'Beta', maxInputTokens: 1000 }),
            makeModel({ id: 'a', name: 'Alpha', maxInputTokens: 2000 }),
            makeModel({ id: 'AUTO', name: 'AUTO', maxInputTokens: 3000 }),
        ];

        const sorted = sortModelsAutoFirst(models);

        expect(sorted.map((m) => m.id)).toEqual(['AUTO', 'b', 'a']);
    });

    it('does not mutate the input array', () => {
        const models = [
            makeModel({ id: 'a', name: 'Alpha', maxInputTokens: 1000 }),
            makeModel({ id: 'auto', name: 'Auto', maxInputTokens: 2000 }),
        ];
        const snapshot = models.map((m) => m.id);

        sortModelsAutoFirst(models);

        expect(models.map((m) => m.id)).toEqual(snapshot);
    });

    it('returns an empty array unchanged', () => {
        expect(sortModelsAutoFirst([])).toEqual([]);
    });
});

describe('resolveSelectedModelId', () => {
    const models = [
        makeModel({ id: 'gpt', name: 'GPT', maxInputTokens: 128_000 }),
        makeModel({ id: 'claude', name: 'Claude', maxInputTokens: 200_000 }),
    ];

    it('returns the saved id when it exists in the list', () => {
        expect(resolveSelectedModelId(models, 'claude')).toBe('claude');
    });

    it('falls back to the first model when the saved id is not found', () => {
        expect(resolveSelectedModelId(models, 'missing')).toBe('gpt');
    });

    it('falls back to the first model when no preference is saved', () => {
        expect(resolveSelectedModelId(models, null)).toBe('gpt');
    });

    it('returns null when there are no models', () => {
        expect(resolveSelectedModelId([], 'anything')).toBeNull();
        expect(resolveSelectedModelId([], null)).toBeNull();
    });
});

describe('getMigrationModels', () => {
    const models = [
        makeModel({ id: 'auto', name: 'Auto', maxInputTokens: 128_000 }),
        makeModel({ id: 'gpt', name: 'GPT', maxInputTokens: 128_000 }),
        makeModel({ id: 'claude', name: 'Claude', maxInputTokens: 200_000 }),
    ];

    it('offers Auto without changing the concrete default or ordering', () => {
        const available = getMigrationModels(models, false);
        expect(available.map((model) => model.id)).toEqual(['gpt', 'claude', 'auto']);
        expect(resolveSelectedModelId(available, null)).toBe('gpt');
        expect(resolveSelectedModelId(available, 'auto')).toBe('auto');
        expect(resolveSelectedModelId(available, 'claude')).toBe('claude');
        expect(models[0].id).toBe('auto');
    });

    it('uses the same legacy fallback for saved Auto and no preference', () => {
        const available = getMigrationModels(models, true);
        expect(available.map((model) => model.id)).toEqual(['gpt', 'claude']);
        expect(resolveSelectedModelId(available, 'auto')).toBe(resolveSelectedModelId(available, null));
        expect(resolveSelectedModelId(available, 'missing')).toBe('gpt');
        expect(resolveSelectedModelId(available, 'claude')).toBe('claude');
        expect(resolveSelectedModelId(getMigrationModels(models, false), 'auto')).toBe('auto');
    });

    it('handles empty and Auto-only lists', () => {
        expect(resolveSelectedModelId(getMigrationModels([], false), 'auto')).toBeNull();
        expect(resolveSelectedModelId(getMigrationModels(models.slice(0, 1), true), 'auto')).toBeNull();
        expect(resolveSelectedModelId(getMigrationModels(models.slice(0, 1), false), null)).toBe('auto');
    });
});

describe('partitionModelsByCapability', () => {
    it('treats a model at exactly the 50k threshold as recommended', () => {
        const models = [makeModel({ id: 'edge', name: 'Edge', maxInputTokens: 50_000 })];

        const { recommended, others } = partitionModelsByCapability(models);

        expect(recommended.map((m) => m.id)).toEqual(['edge']);
        expect(others).toEqual([]);
    });

    it('puts a model just below the threshold into others', () => {
        const models = [makeModel({ id: 'low', name: 'Low', maxInputTokens: 49_999 })];

        const { recommended, others } = partitionModelsByCapability(models);

        expect(recommended).toEqual([]);
        expect(others.map((m) => m.id)).toEqual(['low']);
    });

    it('demotes "mini" variants to others even when above the threshold', () => {
        const models = [
            makeModel({ id: 'mini', name: 'GPT-4o mini', maxInputTokens: 128_000 }),
            makeModel({ id: 'MINI-caps', name: 'Some MINI Model', maxInputTokens: 128_000 }),
        ];

        const { recommended, others } = partitionModelsByCapability(models);

        expect(recommended).toEqual([]);
        expect(others.map((m) => m.id).sort()).toEqual(['MINI-caps', 'mini']);
    });

    it('orders each group by token capacity desc, then name asc', () => {
        const models = [
            makeModel({ id: 'b-big', name: 'Bravo', maxInputTokens: 200_000 }),
            makeModel({ id: 'a-big', name: 'Alpha', maxInputTokens: 200_000 }),
            makeModel({ id: 'huge', name: 'Huge', maxInputTokens: 300_000 }),
            makeModel({ id: 'small', name: 'Small', maxInputTokens: 10_000 }),
            makeModel({ id: 'mini', name: 'Tiny mini', maxInputTokens: 128_000 }),
        ];

        const { recommended, others } = partitionModelsByCapability(models);

        // huge (300k) first, then the two 200k models alphabetically (Alpha before Bravo).
        expect(recommended.map((m) => m.id)).toEqual(['huge', 'a-big', 'b-big']);
        // others: the mini (128k) before the small (10k).
        expect(others.map((m) => m.id)).toEqual(['mini', 'small']);
    });

    it('returns empty groups for an empty input', () => {
        const { recommended, others } = partitionModelsByCapability([]);

        expect(recommended).toEqual([]);
        expect(others).toEqual([]);
    });
});
