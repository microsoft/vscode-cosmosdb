/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { orderBy, partition } from 'es-toolkit';

/**
 * Shared AI model selection utilities used by both the Query Editor and Migration Assistant.
 * This module contains NO vscode imports so it can be used in both extension and webview code.
 */

/** Global state key for persisting the selected Query Editor AI model across sessions. */
export const SELECTED_MODEL_KEY = 'ms-azuretools.vscode-cosmosdb.selectedModel';

/**
 * Global state key for persisting the Migration Assistant's selected AI model.
 * Kept distinct from {@link SELECTED_MODEL_KEY} so migration workflows (which may
 * require higher-capacity models) don't share state with the Query Editor picker.
 */
export const MIGRATION_SELECTED_MODEL_KEY = 'ms-azuretools.vscode-cosmosdb.migration.selectedModel';

/** Information about an available language model. */
export interface ModelInfo {
    id: string;
    name: string;
    family: string;
    vendor: string;
    maxInputTokens: number;
    category?: string;
    supportsToolCalling?: boolean;
}

export function isAutoModel(model: Pick<ModelInfo, 'id' | 'name'>): boolean {
    return model.id === 'auto' || model.name.toLowerCase() === 'auto';
}

export type MigrationModelTier = 'preferred' | 'capable' | 'auto' | 'notRecommended';

export type MigrationModelReason =
    | 'powerfulCategory'
    | 'versatileCategory'
    | 'lightweightCategory'
    | 'noToolCalling'
    | 'reasoningFamily'
    | 'generalPurpose'
    | 'compactFamily'
    | 'limitedContext'
    | 'lightweightFamily'
    | 'legacyFamily'
    | 'unknownFamily'
    | 'automatic';

export const MIGRATION_MODEL_TIERS: readonly MigrationModelTier[] = ['preferred', 'auto', 'capable', 'notRecommended'];

export function getMigrationModelAssessment(model: ModelInfo): {
    tier: MigrationModelTier;
    reason: MigrationModelReason;
} {
    if (isAutoModel(model)) return { tier: 'auto', reason: 'automatic' };
    if (model.supportsToolCalling === false) return { tier: 'notRecommended', reason: 'noToolCalling' };
    if (model.maxInputTokens < RECOMMENDED_MIN_TOKENS) {
        return { tier: 'notRecommended', reason: 'limitedContext' };
    }

    switch (model.category) {
        case 'powerful':
            return { tier: 'preferred', reason: 'powerfulCategory' };
        case 'versatile':
            return { tier: 'capable', reason: 'versatileCategory' };
        case 'lightweight':
            return { tier: 'notRecommended', reason: 'lightweightCategory' };
        case undefined:
        default:
            break;
    }

    // TODO: Review and remove this family-based fallback once the model category API is stable
    // and available across supported VS Code versions.
    const identifiers = [model.family, model.name].map((value) => value.toLowerCase().replace(/[\s_]+/g, '-'));
    const matches = (pattern: RegExp): boolean => identifiers.some((value) => pattern.test(value));
    const knownFamily = matches(
        /^(?:gpt-(?:4o|4\.1|5(?:\.\d+)?)(?:-|$)|gpt-6(?:[.-]\d+)*-(?:astra|sol|terra|luna|codex)(?:-|$)|o[134](?:-|$)|claude-(?:(?:opus|sonnet|haiku)(?:-|$)|[345][\d.-]*-(?:opus|sonnet|haiku)(?:-|$))|gemini-(?:1\.5|[234](?:\.\d+)?)-(?:pro|flash|argon)(?:-|$)|grok-4(?:[.-]|$)|mai-code-1\.1-flash(?:-|$))/,
    );

    if (knownFamily && (matches(/\b(?:nano|haiku|luna)\b/) || matches(/^mai-code-1\.1-flash(?:-|$)/))) {
        return { tier: 'notRecommended', reason: 'lightweightFamily' };
    }
    if (matches(/^(?:gpt-3\.5(?:-|$)|gpt-4(?:-turbo)?(?:-\d+)?$)/)) {
        return { tier: 'notRecommended', reason: 'legacyFamily' };
    }
    if (knownFamily && matches(/\b(?:mini|flash|lite)\b/)) {
        return { tier: 'capable', reason: 'compactFamily' };
    }
    if (matches(/^gpt-[56](?:[.-]\d+)*-(?:terra|chat)(?:-|$)/) || (knownFamily && matches(/\bsonnet\b/))) {
        return { tier: 'capable', reason: 'generalPurpose' };
    }
    if (
        matches(
            /^(?:claude-opus-[45](?:[.-]|$)|claude-[45][\d.-]*-opus(?:-|$)|gpt-5(?:[.-]|$)|gpt-6(?:[.-]\d+)*-(?:astra|sol|codex)(?:-|$)|o[134](?:-|$)|gemini-(?:2\.5|3(?:\.\d+)?)-pro(?:-|$)|gemini-4(?:\.\d+)?-argon(?:-|$))/,
        )
    ) {
        return { tier: 'preferred', reason: 'reasoningFamily' };
    }
    if (knownFamily) {
        return { tier: 'capable', reason: 'generalPurpose' };
    }
    return { tier: 'notRecommended', reason: 'unknownFamily' };
}

function getMigrationModelPreference(model: ModelInfo): {
    familyRank: number;
    family: string | undefined;
    version: number[];
} {
    const [apiPreference, namePreference] = [model.family, model.name].map((identifier) => {
        const normalized = identifier
            .toLowerCase()
            .replace(/[\s_]+/g, '-')
            .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})(?=-|$)/g, '');
        const match = /^(.*?)(\d+(?:[.-]\d+)*)(?=-|$)(.*)$/.exec(normalized);
        if (!match || !/[a-z]/.test(match[1])) return undefined;

        const family = `${match[1]}${match[3]}`.replace(/-+/g, '-').replace(/^-|-$/g, '');
        const preferredFamily = /^(gpt-astra|claude-opus|gpt-sol)(?:-|$)/.exec(family)?.[1];
        const familyRank = preferredFamily ? ['gpt-astra', 'claude-opus', 'gpt-sol'].indexOf(preferredFamily) : 3;
        return {
            familyRank,
            family: preferredFamily ?? family,
            version: match[2].split(/[.-]/).map(Number),
            identifierFamily: family,
        };
    });
    if (!apiPreference) return namePreference ?? { familyRank: 3, family: undefined, version: [] };
    if (
        namePreference &&
        namePreference.identifierFamily === apiPreference.identifierFamily &&
        namePreference.version.length > apiPreference.version.length &&
        apiPreference.version.every((part, index) => part === namePreference.version[index])
    ) {
        return { ...apiPreference, version: namePreference.version };
    }
    return apiPreference;
}

export function getMigrationModels<Model extends ModelInfo>(models: readonly Model[]): Model[] {
    const familyOrders = new Map<string, number>();
    const rankedModels = models.map((model, index) => {
        const tier = getMigrationModelAssessment(model).tier;
        const preference = getMigrationModelPreference(model);
        const familyRank = tier === 'preferred' ? preference.familyRank : 3;
        const familyKey = JSON.stringify([
            tier,
            familyRank,
            model.vendor,
            preference.family ?? null,
            preference.family === undefined ? model.id : null,
        ]);
        const familyOrder = familyOrders.get(familyKey) ?? index;
        familyOrders.set(familyKey, familyOrder);
        return { model, tier, familyRank, familyOrder, version: preference.version };
    });
    return rankedModels
        .sort((first, second) => {
            const groupDifference =
                MIGRATION_MODEL_TIERS.indexOf(first.tier) - MIGRATION_MODEL_TIERS.indexOf(second.tier) ||
                first.familyRank - second.familyRank ||
                first.familyOrder - second.familyOrder;
            if (groupDifference !== 0) return groupDifference;

            const versionLength = Math.max(first.version.length, second.version.length);
            for (let index = 0; index < versionLength; index++) {
                const versionDifference = (second.version[index] ?? 0) - (first.version[index] ?? 0);
                if (versionDifference !== 0) return versionDifference;
            }
            return 0;
        })
        .map(({ model }) => model);
}

/**
 * Formats a token count into a compact human-readable string (e.g. 128000 → "128k").
 */
export function formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens % 1_000 === 0 ? 0 : 1)}k`;
    return String(tokens);
}

/**
 * Sorts models so that "Auto" appears first in the list, preserving the order of other models.
 */
export function sortModelsAutoFirst(models: ModelInfo[]): ModelInfo[] {
    return [...models].sort((a, b) => {
        const aIsAuto = a.name.toLowerCase() === 'auto';
        const bIsAuto = b.name.toLowerCase() === 'auto';
        if (aIsAuto && !bIsAuto) return -1;
        if (!aIsAuto && bIsAuto) return 1;
        return 0;
    });
}

/**
 * Resolves which model ID should be selected given the available models and a saved preference.
 * Returns the saved model if it exists in the list, otherwise falls back to the first model.
 */
export function resolveSelectedModelId(models: ModelInfo[], savedModelId: string | null): string | null {
    if (savedModelId && models.some((m) => m.id === savedModelId)) {
        return savedModelId;
    }
    return models[0]?.id ?? null;
}

const RECOMMENDED_MIN_TOKENS = 50_000;

/**
 * Partitions models into "recommended" (≥50k max input tokens and not a "-mini" variant)
 * and "others" (everything else).
 *
 * Within each group, models are ordered by capacity (highest `maxInputTokens` first),
 * with ties broken alphabetically by name.
 */
export function partitionModelsByCapability(models: ModelInfo[]): {
    recommended: ModelInfo[];
    others: ModelInfo[];
} {
    const [recommended, others] = partition(
        models,
        (model) => model.maxInputTokens >= RECOMMENDED_MIN_TOKENS && !model.name.toLowerCase().includes('mini'),
    );

    const byTokensThenName = (list: ModelInfo[]): ModelInfo[] =>
        orderBy(list, [(m) => m.maxInputTokens, (m) => m.name], ['desc', 'asc']);

    return { recommended: byTokensThenName(recommended), others: byTokensThenName(others) };
}
