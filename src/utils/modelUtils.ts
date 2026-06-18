/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { orderBy, partition } from 'es-toolkit';

/**
 * Shared AI model selection utilities used by both the Query Editor and Migration Assistant.
 * This module contains NO vscode imports so it can be used in both extension and webview code.
 */

/** Global state key for persisting the selected AI model across sessions (chat / query editor). */
export const SELECTED_MODEL_KEY = 'ms-azuretools.vscode-cosmosdb.selectedModel';

/**
 * Global state key for persisting the Migration Assistant's selected AI model.
 * Kept distinct from {@link SELECTED_MODEL_KEY} so migration workflows (which may
 * require higher-capacity models) don't share state with the chat participant /
 * query editor picker.
 */
export const MIGRATION_SELECTED_MODEL_KEY = 'ms-azuretools.vscode-cosmosdb.migration.selectedModel';

/** Information about an available language model. */
export interface ModelInfo {
    id: string;
    name: string;
    family: string;
    vendor: string;
    maxInputTokens: number;
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
