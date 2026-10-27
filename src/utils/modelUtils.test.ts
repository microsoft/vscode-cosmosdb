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
    getMigrationModelAssessment,
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

    it('passes optional provider metadata to the webview without enabling proposed APIs', async () => {
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
            { ...models[1], category: 'powerful', capabilities: { supportsToolCalling: true } },
            { ...models[2], category: 'versatile', capabilities: { supportsToolCalling: false } },
        ] as vscode.LanguageModelChat[]);
        expect((await getAvailableModelsInfo()).models).toEqual([
            { ...models[1], category: 'powerful', supportsToolCalling: true },
            { ...models[2], category: 'versatile', supportsToolCalling: false },
        ]);
        expect(vscode.lm.selectChatModels).toHaveBeenCalledWith({ vendor: 'copilot' });
    });

    it('keeps the first equivalent migration model and resolves a saved alias to it', async () => {
        const first = {
            ...models[1],
            version: 'model-v1',
            category: 'powerful',
            capabilities: { supportsToolCalling: true, supportsImageToText: true },
            inputCost: 175,
            outputCost: 1400,
            sendRequest: vi.fn(),
        };
        const alias = {
            ...first,
            id: 'copilot-utility',
            family: 'copilot-utility',
            capabilities: { supportsImageToText: true, supportsToolCalling: true },
            sendRequest: vi.fn(),
        };
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
            first,
            alias,
            models[2],
        ] as vscode.LanguageModelChat[]);
        vi.mocked(ext.context.globalState.get).mockReturnValue(alias.id);

        expect(await getAvailableModelsInfo(MIGRATION_SELECTED_MODEL_KEY, { includeAuto: true })).toEqual({
            models: [{ ...models[1], category: 'powerful', supportsToolCalling: true }, models[2]],
            savedModelId: first.id,
        });
        expect(ext.context.globalState.update).not.toHaveBeenCalled();
        expect((await getAvailableModelsInfo()).models.map((model) => model.id)).toEqual([
            first.id,
            alias.id,
            models[2].id,
        ]);
    });

    it.each([
        { version: 'model-v2' },
        { maxInputTokens: 200_000 },
        { vendor: 'another-provider' },
        { category: 'versatile' },
        { inputCost: 200 },
        { capabilities: { supportsToolCalling: false } },
        { capabilities: { supportsToolCalling: true, supportsImageToText: true } },
        { futureCapability: true },
    ])('retains same-name migration models when metadata differs: %j', async (difference) => {
        const first = {
            ...models[1],
            version: 'model-v1',
            category: 'powerful',
            capabilities: { supportsToolCalling: true },
            inputCost: 175,
            sendRequest: vi.fn(),
            countTokens: vi.fn(),
        };
        const second = { ...first, id: 'second-registration', ...difference };
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([first, second] as vscode.LanguageModelChat[]);
        expect((await getAvailableModelsInfo(MIGRATION_SELECTED_MODEL_KEY)).models.map((model) => model.id)).toEqual([
            first.id,
            second.id,
        ]);
    });

    it('does not deduplicate when version or readable metadata is unavailable', async () => {
        const unavailable = Object.defineProperty({ ...models[1], id: 'unreadable', version: 'model-v1' }, 'category', {
            enumerable: true,
            get: () => {
                throw new Error('Unavailable metadata');
            },
        });
        const available = { ...models[1], id: 'readable', version: 'model-v1' };
        const aliasWithoutVersion = { ...models[1], id: 'unknown-version' };
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
            models[1],
            aliasWithoutVersion,
            unavailable,
            available,
        ] as vscode.LanguageModelChat[]);
        expect((await getAvailableModelsInfo(MIGRATION_SELECTED_MODEL_KEY)).models.map((model) => model.id)).toEqual([
            models[1].id,
            aliasWithoutVersion.id,
            unavailable.id,
            available.id,
        ]);
    });

    it.each(['category', 'capabilities'])('retains the model list if reading %s throws', async (property) => {
        const unavailable = Object.defineProperty({ ...models[1] }, property, {
            get: () => {
                throw new Error('Proposed API is unavailable');
            },
        });
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([unavailable, models[2]] as vscode.LanguageModelChat[]);
        expect((await getAvailableModelsInfo()).models).toEqual(models.slice(1));
    });

    it('accepts partial metadata and ignores malformed optional fields', async () => {
        vi.mocked(vscode.lm.selectChatModels).mockResolvedValue([
            { ...models[1], category: 'powerful' },
            { ...models[2], capabilities: { supportsToolCalling: false } },
            { ...models[1], category: 42, capabilities: { supportsToolCalling: 'false' } },
        ] as unknown as vscode.LanguageModelChat[]);
        expect((await getAvailableModelsInfo()).models).toEqual([
            { ...models[1], category: 'powerful' },
            { ...models[2], supportsToolCalling: false },
            models[1],
        ]);
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

    it('defaults to Auto when no preferred models are available and preserves saved choices', () => {
        const available = getMigrationModels(models);
        expect(available.map((model) => model.id)).toEqual(['auto', 'gpt', 'claude']);
        expect(resolveSelectedModelId(available, null)).toBe('auto');
        expect(resolveSelectedModelId(available, 'auto')).toBe('auto');
        expect(resolveSelectedModelId(available, 'claude')).toBe('claude');
        expect(models[0].id).toBe('auto');
    });

    it('falls back to Auto when the saved preference and preferred models are unavailable', () => {
        const available = getMigrationModels(models);
        expect(resolveSelectedModelId(available, 'missing')).toBe('auto');
        expect(resolveSelectedModelId(available, 'claude')).toBe('claude');
        expect(resolveSelectedModelId(available, 'auto')).toBe('auto');
    });

    it('handles empty and Auto-only lists', () => {
        expect(resolveSelectedModelId(getMigrationModels([]), 'auto')).toBeNull();
        expect(resolveSelectedModelId(getMigrationModels(models.slice(0, 1)), 'auto')).toBe('auto');
        expect(resolveSelectedModelId(getMigrationModels(models.slice(0, 1)), null)).toBe('auto');
    });

    it('ranks migration suitability ahead of context size while preserving saved choices', () => {
        const candidates = [
            makeModel({ id: 'nano', name: 'GPT-5 nano', maxInputTokens: 1_000_000 }),
            makeModel({ id: 'mini', name: 'GPT-5 mini', maxInputTokens: 400_000 }),
            makeModel({ id: 'custom', name: 'Custom', maxInputTokens: 2_000_000 }),
            makeModel({ id: 'auto', name: 'Auto', maxInputTokens: 0 }),
            makeModel({ id: 'opus', name: 'Claude Opus 4.5', maxInputTokens: 200_000 }),
        ];
        const available = getMigrationModels(candidates);
        expect(available.map((model) => model.id)).toEqual(['opus', 'auto', 'mini', 'nano', 'custom']);
        expect(resolveSelectedModelId(available, null)).toBe('opus');
        expect(resolveSelectedModelId(available, 'nano')).toBe('nano');
        expect(resolveSelectedModelId(available, 'auto')).toBe('auto');
        expect(candidates[0].id).toBe('nano');
    });

    it('orders provider categories and does not recommend lightweight models while preserving saved choices', () => {
        const candidates = ['lightweight', 'versatile', 'powerful'].map((category) =>
            makeModel({ id: category, name: category, maxInputTokens: 200_000, category }),
        );
        const available = getMigrationModels(candidates);
        expect(available.map((model) => model.id)).toEqual(['powerful', 'versatile', 'lightweight']);
        expect(resolveSelectedModelId(available, null)).toBe('powerful');
        expect(resolveSelectedModelId(available, 'lightweight')).toBe('lightweight');
        expect(available.map((model) => getMigrationModelAssessment(model).tier)).toEqual([
            'preferred',
            'capable',
            'notRecommended',
        ]);
    });

    it('does not recommend a reasoning family with insufficient context', () => {
        expect(getMigrationModelAssessment(makeModel({ id: 'small', name: 'GPT-5', maxInputTokens: 32_000 }))).toEqual({
            tier: 'notRecommended',
            reason: 'limitedContext',
        });
    });

    it('ranks powerful models by Astra, Opus, Sol, then others, with newer versions first', () => {
        const names = [
            'Other model A',
            'GPT-6.9 Sol',
            'Claude Opus 5.5',
            'GPT-6 Astra',
            'GPT-6.10 Sol',
            'Claude Opus 5.10',
            'Other model B',
            'GPT-6 Sol',
            'GPT-6.1 Astra',
        ];
        const candidates = names.map((name) =>
            makeModel({ id: name, name, category: 'powerful', maxInputTokens: 200_000 }),
        );
        const available = getMigrationModels(candidates);
        expect(available.map((model) => model.name)).toEqual([
            'GPT-6.1 Astra',
            'GPT-6 Astra',
            'Claude Opus 5.10',
            'Claude Opus 5.5',
            'GPT-6.10 Sol',
            'GPT-6.9 Sol',
            'GPT-6 Sol',
            'Other model A',
            'Other model B',
        ]);
        expect(candidates.map((model) => model.name)).toEqual(names);
        expect(resolveSelectedModelId(available, null)).toBe('GPT-6.1 Astra');
        expect(resolveSelectedModelId(available, 'GPT-6 Sol')).toBe('GPT-6 Sol');
    });

    it('uses API families and supports both Claude version naming formats', () => {
        const candidates = ['gpt-6.1-sol', 'claude-4-5-opus', 'claude-opus-5-5', 'gpt-6-astra'].map((family) =>
            makeModel({ id: family, name: 'Deployment', family, category: 'powerful', maxInputTokens: 200_000 }),
        );
        expect(getMigrationModels(candidates).map((model) => model.id)).toEqual([
            'gpt-6-astra',
            'claude-opus-5-5',
            'claude-4-5-opus',
            'gpt-6.1-sol',
        ]);
    });

    it('preserves provider order for equal versions and sorts other powerful families numerically', () => {
        const names = ['Unknown 9', 'GPT-5.6 Sol Fast', 'Unknown 10', 'GPT-5.6.0 Sol', 'GPT-5.6 Sol'];
        const candidates = names.map((name) =>
            makeModel({ id: name, name, category: 'powerful', maxInputTokens: 200_000 }),
        );
        expect(getMigrationModels(candidates).map((model) => model.name)).toEqual([
            'GPT-5.6 Sol Fast',
            'GPT-5.6.0 Sol',
            'GPT-5.6 Sol',
            'Unknown 10',
            'Unknown 9',
        ]);
    });

    it.each([
        ['Claude Sonnet 5', 'Claude Sonnet 5.5', 'versatile'],
        ['Claude Haiku 4.5', 'Claude Haiku 5.5', 'lightweight'],
        ['Grok 4.6', 'Grok 4.7', 'versatile'],
        ['Gemini 2.5 Pro', 'Gemini 3 Pro', 'powerful'],
        ['GPT-5.2-Codex', 'GPT-5.3-Codex', 'powerful'],
        ['GPT-6 Terra', 'GPT-6.1 Terra', 'versatile'],
        ['Custom 2.9', 'Custom 2.10', undefined],
        ['Qwen2.5', 'Qwen3', undefined],
        ['Claude Opus 4.5', 'Claude Opus 4.6', undefined],
    ])('ranks %s below %s within the same suitability tier', (older, newer, category) => {
        const candidates = [older, newer].map((name) =>
            makeModel({ id: name, name, category, maxInputTokens: 200_000 }),
        );
        expect(getMigrationModels(candidates).map((model) => model.name)).toEqual([newer, older]);
        expect(candidates.map((model) => model.name)).toEqual([older, newer]);
    });

    it('groups interleaved families in first-seen order before comparing their versions', () => {
        const names = ['Grok 4.6', 'GPT-6 Terra', 'Grok 4.10', 'Claude Sonnet 5.5', 'GPT-6.1 Terra', 'Grok 4.7'];
        const candidates = names.map((name) =>
            makeModel({ id: name, name, category: 'versatile', maxInputTokens: 200_000 }),
        );
        const available = getMigrationModels(candidates);
        expect(available.map((model) => model.name)).toEqual([
            'Grok 4.10',
            'Grok 4.7',
            'Grok 4.6',
            'GPT-6.1 Terra',
            'GPT-6 Terra',
            'Claude Sonnet 5.5',
        ]);
        expect(getMigrationModels(available)).toEqual(available);
        expect(resolveSelectedModelId(available, 'Grok 4.6')).toBe('Grok 4.6');
    });

    it('normalizes dated API families and Claude version placement without treating dates as versions', () => {
        const families = ['claude-4-5-sonnet-20261027', 'claude-sonnet-5-5-20261001', 'claude-sonnet-5-5'];
        const candidates = families.map((family) =>
            makeModel({ id: family, name: 'Deployment', family, category: 'versatile', maxInputTokens: 200_000 }),
        );
        expect(getMigrationModels(candidates).map((model) => model.id)).toEqual([
            'claude-sonnet-5-5-20261001',
            'claude-sonnet-5-5',
            'claude-4-5-sonnet-20261027',
        ]);
    });

    it('does not compare unrelated variants, vendors, or context-size labels as model versions', () => {
        const candidates = [
            makeModel({ id: 'mini', name: 'GPT-5 mini', category: 'versatile', maxInputTokens: 200_000 }),
            makeModel({ id: 'full', name: 'GPT-6', category: 'versatile', maxInputTokens: 200_000 }),
            makeModel({
                id: 'vendor-a',
                name: 'Grok 4.6',
                vendor: 'a',
                category: 'versatile',
                maxInputTokens: 200_000,
            }),
            makeModel({
                id: 'vendor-b',
                name: 'Grok 4.7',
                vendor: 'b',
                category: 'versatile',
                maxInputTokens: 200_000,
            }),
            makeModel({
                id: 'small-context',
                name: 'Custom 128k',
                category: 'versatile',
                maxInputTokens: 128_000,
            }),
            makeModel({
                id: 'large-context',
                name: 'Custom 256k',
                category: 'versatile',
                maxInputTokens: 256_000,
            }),
        ];
        expect(getMigrationModels(candidates)).toEqual(candidates);
    });

    it('keeps Auto and suitability checks ahead of family preferences', () => {
        const candidates = [
            makeModel({
                id: 'no-tools',
                name: 'GPT-6 Astra',
                category: 'powerful',
                maxInputTokens: 200_000,
                supportsToolCalling: false,
            }),
            makeModel({
                id: 'versatile',
                name: 'Claude Opus 5.5',
                category: 'versatile',
                maxInputTokens: 200_000,
            }),
            makeModel({ id: 'auto', name: 'Auto', maxInputTokens: 0 }),
            makeModel({ id: 'sol', name: 'GPT-6 Sol', category: 'powerful', maxInputTokens: 200_000 }),
            makeModel({
                id: 'small-context',
                name: 'GPT-7 Astra',
                category: 'powerful',
                maxInputTokens: 32_000,
            }),
        ];
        expect(getMigrationModels(candidates).map((model) => model.id)).toEqual([
            'sol',
            'auto',
            'versatile',
            'small-context',
            'no-tools',
        ]);
    });
});

describe('getMigrationModelAssessment', () => {
    it.each([
        ['powerful', 'preferred', 'powerfulCategory'],
        ['versatile', 'capable', 'versatileCategory'],
        ['lightweight', 'notRecommended', 'lightweightCategory'],
        ['future-category', 'notRecommended', 'lightweightFamily'],
        [undefined, 'notRecommended', 'lightweightFamily'],
    ])('prefers known provider category %s over the family heuristic', (category, tier, reason) => {
        const model = makeModel({ id: 'model', name: 'GPT-5 nano', maxInputTokens: 200_000, category });
        expect(getMigrationModelAssessment(model)).toEqual({ tier, reason });
    });

    it('demotes explicit lack of tool calling without treating missing metadata as unsupported', () => {
        const model = makeModel({ id: 'model', name: 'Custom model', maxInputTokens: 200_000, category: 'powerful' });
        expect(getMigrationModelAssessment({ ...model, supportsToolCalling: false })).toEqual({
            tier: 'notRecommended',
            reason: 'noToolCalling',
        });
        expect(getMigrationModelAssessment({ ...model, supportsToolCalling: true }).tier).toBe('preferred');
        expect(getMigrationModelAssessment(model).tier).toBe('preferred');
        expect(getMigrationModelAssessment({ ...model, maxInputTokens: 32_000 }).reason).toBe('limitedContext');
    });

    it('keeps Auto separate even if its reported capabilities do not match a concrete model', () => {
        expect(
            getMigrationModelAssessment(
                makeModel({
                    id: 'auto',
                    name: 'Auto',
                    maxInputTokens: 0,
                    category: 'powerful',
                    supportsToolCalling: false,
                }),
            ),
        ).toEqual({ tier: 'auto', reason: 'automatic' });
    });

    it.each([
        ['Claude Opus 4.5', 'preferred', 'reasoningFamily'],
        ['Claude Sonnet 4.6', 'capable', 'generalPurpose'],
        ['claude-3.7-sonnet', 'capable', 'generalPurpose'],
        ['claude-3.5-sonnet', 'capable', 'generalPurpose'],
        ['Claude Haiku 4.5', 'notRecommended', 'lightweightFamily'],
        ['GPT-5', 'preferred', 'reasoningFamily'],
        ['GPT-5.2-Codex', 'preferred', 'reasoningFamily'],
        ['GPT-5.1-Codex-mini', 'capable', 'compactFamily'],
        ['GPT-5 mini', 'capable', 'compactFamily'],
        ['GPT-5 nano', 'notRecommended', 'lightweightFamily'],
        ['gpt-5-chat-latest', 'capable', 'generalPurpose'],
        ['GPT-4.1', 'capable', 'generalPurpose'],
        ['GPT-4.1 nano', 'notRecommended', 'lightweightFamily'],
        ['GPT-4o', 'capable', 'generalPurpose'],
        ['GPT-4', 'notRecommended', 'legacyFamily'],
        ['GPT-3.5-turbo', 'notRecommended', 'legacyFamily'],
        ['o3', 'preferred', 'reasoningFamily'],
        ['o4-mini', 'capable', 'compactFamily'],
        ['Gemini 2.5 Pro', 'preferred', 'reasoningFamily'],
        ['Gemini 3 Pro Preview', 'preferred', 'reasoningFamily'],
        ['Gemini 2.5 Flash', 'capable', 'compactFamily'],
        ['Custom reasoning model', 'notRecommended', 'unknownFamily'],
        ['Custom mini', 'notRecommended', 'unknownFamily'],
        ['Custom nano', 'notRecommended', 'unknownFamily'],
        ['MAI-Code-2-Flash (Preview)', 'notRecommended', 'unknownFamily'],
    ])('assesses %s as %s', (name, tier, reason) => {
        expect(getMigrationModelAssessment(makeModel({ id: name, name, maxInputTokens: 200_000 }))).toEqual({
            tier,
            reason,
        });
    });

    it.each([
        ['Claude Haiku 5.5', 'lightweight'],
        ['Claude Opus 5.5', 'powerful'],
        ['Claude Sonnet 5.5', 'versatile'],
        ['Claude Sonnet 5', 'versatile'],
        ['Gemini 3.8 Flash', 'versatile'],
        ['Gemini 4 Argon', 'powerful'],
        ['GPT-5.3-Codex', 'powerful'],
        ['GPT-5.6 Luna', 'lightweight'],
        ['GPT-5.6 Sol Fast (Internal only)', 'powerful'],
        ['GPT-5.6 Sol', 'powerful'],
        ['GPT-5.6 Terra', 'versatile'],
        ['GPT-6.1 Sol', 'powerful'],
        ['GPT-6.1 Terra', 'versatile'],
        ['GPT-6 Astra', 'powerful'],
        ['GPT-6 Luna', 'lightweight'],
        ['GPT-6 Sol', 'powerful'],
        ['Grok 4.6', 'versatile'],
        ['Grok 4.7', 'versatile'],
        ['MAI-Code-1.1-Flash', 'lightweight'],
    ])('matches the observed %s category when provider metadata is absent', (name, category) => {
        const model = makeModel({ id: name, name, maxInputTokens: 200_000 });
        const expected = getMigrationModelAssessment({ ...model, category }).tier;
        expect(getMigrationModelAssessment(model).tier).toBe(expected);
        expect(getMigrationModelAssessment({ ...model, category: 'unrecognized-category' }).tier).toBe(expected);
        expect(getMigrationModelAssessment({ ...model, name: 'Deployment', family: name }).tier).toBe(expected);
    });

    it('keeps provider metadata and suitability constraints above fallback family rules', () => {
        const model = makeModel({ id: 'model', name: 'GPT-6 Astra', maxInputTokens: 200_000 });
        expect(getMigrationModelAssessment({ ...model, category: 'versatile' }).tier).toBe('capable');
        expect(getMigrationModelAssessment({ ...model, category: 'lightweight' }).tier).toBe('notRecommended');
        expect(getMigrationModelAssessment({ ...model, supportsToolCalling: false }).reason).toBe('noToolCalling');
        expect(getMigrationModelAssessment({ ...model, maxInputTokens: 32_000 }).reason).toBe('limitedContext');
    });

    it.each(['Custom Luna', 'Custom Opus', 'GPT-6 Unknown', 'MAI-Code-Unknown', 'Grokker 4.7'])(
        'does not recommend unfamiliar model %s',
        (name) => {
            expect(getMigrationModelAssessment(makeModel({ id: name, name, maxInputTokens: 200_000 }))).toEqual({
                tier: 'notRecommended',
                reason: 'unknownFamily',
            });
        },
    );

    it('uses the API family even when the display name is unfamiliar', () => {
        expect(
            getMigrationModelAssessment(
                makeModel({ id: 'opaque-id', name: 'My model', family: 'gpt-5.2', maxInputTokens: 200_000 }),
            ),
        ).toEqual({ tier: 'preferred', reason: 'reasoningFamily' });
    });

    it('does not confuse capacity with reasoning ability at the context threshold', () => {
        const model = makeModel({ id: 'model', name: 'GPT-5', maxInputTokens: 49_999 });
        expect(getMigrationModelAssessment(model).tier).toBe('notRecommended');
        expect(getMigrationModelAssessment({ ...model, maxInputTokens: 50_000 }).tier).toBe('preferred');
        expect(getMigrationModelAssessment({ ...model, name: 'Unknown', maxInputTokens: 2_000_000 }).tier).toBe(
            'notRecommended',
        );
    });

    it('applies experience-based preference and numeric versions without category metadata', () => {
        const models = ['GPT-6 Sol', 'GPT-6.1 Sol', 'Claude Opus 5.5', 'GPT-6 Astra', 'Gemini 4 Argon'].map(
            (name, index) => makeModel({ id: name, name, maxInputTokens: 100_000 * (index + 1) }),
        );
        const available = getMigrationModels(models);
        expect(available.map((model) => model.name)).toEqual([
            'GPT-6 Astra',
            'Claude Opus 5.5',
            'GPT-6.1 Sol',
            'GPT-6 Sol',
            'Gemini 4 Argon',
        ]);
        expect(resolveSelectedModelId(available, 'GPT-6 Sol')).toBe('GPT-6 Sol');
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
