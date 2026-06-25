/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared VS Code Language Model utilities used by both the Cosmos DB chat participant
 * and the migration assistant. This module imports `vscode` and is only safe to use
 * from extension-side code (not webviews). For vscode-free model utilities (types,
 * formatters, global-state keys), see `./modelUtils.ts`.
 */

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { SELECTED_MODEL_KEY } from './modelUtils';

/**
 * Master switch to control whether third-party (non-Copilot) language models are allowed.
 * When false, all model selection is restricted to `{ vendor: 'copilot' }`.
 * When true, all available models (including 3P) are returned.
 */
const allow3pModels = false;

/** Selector used by all model lookups; gated by {@link allow3pModels}. */
const modelSelector: vscode.LanguageModelChatSelector = allow3pModels ? {} : { vendor: 'copilot' };

// ─── Test-only model override (e2e) ─────────────────────────────────

/**
 * Test-only override for the Copilot model list. Set **exclusively** by the
 * `cosmosDB.e2e.setMockLanguageModels` command, which is registered only when
 * `COSMOSDB_E2E_TEST=1` (see {@link file://./../commands/e2eTestCommands/registerE2eTestCommands.ts}).
 *
 * When defined, {@link getAvailableModelsInfo} and {@link getSelectedModel}
 * return these fixtures instead of calling `vscode.lm.selectChatModels`, so
 * Playwright specs can exercise the model switcher without a real Copilot
 * installation in the test VS Code. It stays `undefined` (and therefore inert)
 * in production because the setter is never wired up outside e2e mode.
 */
let e2eModelOverride: readonly AvailableModelDescriptor[] | undefined;

/**
 * Installs (or, with `undefined`, clears) the {@link e2eModelOverride}.
 * Intended for e2e test commands only.
 */
export function setE2eModelOverride(models: readonly AvailableModelDescriptor[] | undefined): void {
    e2eModelOverride = models;
}

// ─── Model selection ────────────────────────────────────────────────

/**
 * Options for {@link getSelectedModel}.
 */
export interface GetSelectedModelOptions {
    /**
     * Explicit model id to select. If provided and available, takes precedence over
     * the saved preference. Falls back to the saved preference (and then the first
     * available model) if the specified id is not found.
     */
    modelId?: string;
    /**
     * Global state key to read the saved model preference from.
     * Defaults to {@link SELECTED_MODEL_KEY}.
     */
    stateKey?: string;
}

/**
 * Resolves the current AI model from Copilot.
 *
 * Resolution order:
 *  1. `options.modelId` if provided and available
 *  2. Saved preference in global state under `options.stateKey` (defaults to {@link SELECTED_MODEL_KEY})
 *  3. First available model
 *
 * @throws If no Copilot models are available.
 */
export async function getSelectedModel(options?: GetSelectedModelOptions): Promise<vscode.LanguageModelChat> {
    if (e2eModelOverride) {
        if (e2eModelOverride.length === 0) {
            throw new Error(l10n.t('No language models available. Please ensure you have access to Copilot.'));
        }
        const explicitMock = options?.modelId ? e2eModelOverride.find((m) => m.id === options.modelId) : undefined;
        const savedMockId = ext.context.globalState.get<string>(options?.stateKey ?? SELECTED_MODEL_KEY);
        const chosen =
            explicitMock ??
            (savedMockId ? e2eModelOverride.find((m) => m.id === savedMockId) : undefined) ??
            e2eModelOverride[0];
        // The mock descriptor only carries the fields the webview reads (id /
        // name); it is never used to issue a real `sendRequest`.
        return chosen as unknown as vscode.LanguageModelChat;
    }

    const models = await vscode.lm.selectChatModels(modelSelector);
    if (models.length === 0) {
        throw new Error(l10n.t('No language models available. Please ensure you have access to Copilot.'));
    }

    const explicit = options?.modelId ? models.find((m) => m.id === options.modelId) : undefined;
    if (explicit) {
        return explicit;
    }

    const savedModelId = ext.context.globalState.get<string>(options?.stateKey ?? SELECTED_MODEL_KEY);
    return (savedModelId && models.find((m) => m.id === savedModelId)) || models[0];
}

/** Minimal descriptor for an available Copilot model, suitable for passing to webviews. */
export interface AvailableModelDescriptor {
    id: string;
    name: string;
    family: string;
    vendor: string;
    maxInputTokens: number;
}

/**
 * Returns the list of available Copilot models filtered to those usable for
 * `sendRequest`/`countTokens` calls. The "Auto" virtual model is excluded because
 * it does not support those APIs, and is therefore unsuitable for the chat
 * participant and migration assistant flows.
 *
 * @returns `{ models, savedModelId }` where `savedModelId` is the currently saved
 *   preference (or `null` if none). Returns empty list on error.
 */
export async function getAvailableModelsInfo(
    stateKey: string = SELECTED_MODEL_KEY,
): Promise<{ models: AvailableModelDescriptor[]; savedModelId: string | null }> {
    if (e2eModelOverride) {
        const savedModelId = ext.context.globalState.get<string>(stateKey) ?? null;
        return { models: [...e2eModelOverride], savedModelId };
    }

    try {
        const allModels = await vscode.lm.selectChatModels(modelSelector);
        const savedModelId = ext.context.globalState.get<string>(stateKey) ?? null;

        // Filter out the "Auto" virtual model — it doesn't support countTokens or sendRequest.
        const models = allModels
            .filter((m) => m.id !== 'auto' && m.name.toLowerCase() !== 'auto')
            .map((m) => ({
                id: m.id,
                name: m.name,
                family: m.family,
                vendor: m.vendor,
                maxInputTokens: m.maxInputTokens,
            }));

        return { models, savedModelId };
    } catch {
        return { models: [], savedModelId: null };
    }
}

// ─── Token telemetry ────────────────────────────────────────────────

/**
 * Options for {@link logLlmTokenUsage}.
 */
export interface LogLlmTokenUsageOptions {
    /** Short identifier for the caller/feature (used in telemetry and output). */
    caller: string;
    /** Instruction/system message (counted as `instructionTokens`). */
    instructionMessage?: vscode.LanguageModelChatMessage;
    /** User message (counted as `userTokens`). */
    userMessage?: vscode.LanguageModelChatMessage;
    /**
     * Pre-computed input token count (e.g. from `renderPrompt` in `@vscode/prompt-tsx`).
     * When provided, `instructionMessage`/`userMessage` are ignored for token counting.
     */
    inputTokenCount?: number;
    /** Response text to count as `outputTokens`. If omitted, output is not counted. */
    responseText?: string;
    /** Optional cancellation token passed to `model.countTokens`. */
    token?: vscode.CancellationToken;
    /** Optional label prefix for output channel lines (e.g. `"Chat Request"`, `"Migration"`). */
    logLabel?: string;
}

/**
 * Unified token-counting + telemetry helper. Counts tokens for the provided
 * instruction/user messages (or uses `inputTokenCount`) and optionally the
 * response text, logs a consolidated line to the output channel, and reports
 * the measurements via `cosmosDB.ai.llmRequest` telemetry.
 *
 * Token counting is best-effort: failures are swallowed so they never block a
 * caller's workflow.
 */
export async function logLlmTokenUsage(
    model: vscode.LanguageModelChat,
    options: LogLlmTokenUsageOptions,
): Promise<void> {
    await callWithTelemetryAndErrorHandling('cosmosDB.ai.llmRequest', async (ctx) => {
        ctx.errorHandling.suppressDisplay = true;
        ctx.telemetry.properties.caller = options.caller;
        ctx.telemetry.properties.modelId = model.id;
        ctx.telemetry.properties.modelName = model.name;
        ctx.telemetry.properties.modelFamily = model.family;

        try {
            let instructionTokens = 0;
            let userTokens = 0;
            let inputTokens: number;

            if (typeof options.inputTokenCount === 'number') {
                inputTokens = options.inputTokenCount;
            } else {
                const [i, u] = await Promise.all([
                    options.instructionMessage
                        ? model.countTokens(options.instructionMessage, options.token)
                        : Promise.resolve(0),
                    options.userMessage ? model.countTokens(options.userMessage, options.token) : Promise.resolve(0),
                ]);
                instructionTokens = i;
                userTokens = u;
                inputTokens = i + u;
            }

            const outputTokens = options.responseText
                ? await model.countTokens(options.responseText, options.token)
                : 0;

            const maxTokens = model.maxInputTokens;
            const pct = maxTokens > 0 ? (inputTokens / maxTokens) * 100 : 0;

            ctx.telemetry.measurements.instructionTokens = instructionTokens;
            ctx.telemetry.measurements.userTokens = userTokens;
            ctx.telemetry.measurements.requestTokens = inputTokens;
            ctx.telemetry.measurements.maxInputTokens = maxTokens;
            if (options.responseText !== undefined) {
                ctx.telemetry.measurements.outputTokens = outputTokens;
            }

            const prefix = options.logLabel ? `[${options.logLabel}] ` : '';
            const detail =
                typeof options.inputTokenCount === 'number'
                    ? `input=${inputTokens}`
                    : `instructionTokens=${instructionTokens}, userTokens=${userTokens}, input=${inputTokens}`;
            const outputPart = options.responseText !== undefined ? `, output=${outputTokens}` : '';
            const total = inputTokens + outputTokens;
            const base =
                `${prefix}model="${model.name}" (${model.family}), ${detail}${outputPart}, ` +
                `total=${total}, maxInputTokens=${maxTokens}, usage=${pct.toFixed(1)}%`;

            if (pct >= 100) {
                ext.outputChannel.error(`${base} — ❌ BUDGET EXCEEDED, prompt content was truncated`);
            } else if (pct >= 90) {
                ext.outputChannel.warn(`${base} — ⚠ NEAR LIMIT, content may be truncated`);
            } else {
                ext.outputChannel.info(base);
            }
        } catch {
            // Token counting is best-effort; never block the caller's workflow.
        }
    });
}

// ─── JSON extraction ────────────────────────────────────────────────

/**
 * Extracts the outermost JSON object from an LLM response string.
 *
 * LLM responses often contain narrative text with curly braces before the
 * actual JSON payload (e.g., `"the {ProductCatalog} domain"`). A simple
 * greedy regex `/\{[\s\S]*\}/` captures from the first `{` to the last `}`,
 * which may include invalid preamble text.
 *
 * This function searches **backward** from the last `}` in the text,
 * trying `JSON.parse` at each preceding `{` until a valid parse succeeds.
 * This works because the JSON payload is always the last (or only) block
 * in the response, after any narrative preamble.
 *
 * @returns The parsed JSON string (i.e. the raw JSON text that `JSON.parse`
 *   accepted), or `null` if no valid JSON object is found.
 */
export function extractJsonObject(text: string): string | null {
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace < 0) return null;

    // Walk backward through each '{' and try to parse the substring
    let searchFrom = lastBrace;
    while (searchFrom >= 0) {
        const openBrace = text.lastIndexOf('{', searchFrom);
        if (openBrace < 0) break;

        const candidate = text.slice(openBrace, lastBrace + 1);
        try {
            JSON.parse(candidate);
            return candidate;
        } catch {
            // Not valid JSON from this '{'; try the next one further left
            searchFrom = openBrace - 1;
        }
    }

    return null;
}

// ─── Token estimation ───────────────────────────────────────────────

/** Characters-per-token heuristic used for estimating LLM token cost of file content. */
export const CHARS_PER_TOKEN = 4;

/** Maximum estimated tokens returned by workspace/schema file readers before truncation. */
export const MAX_FILE_TOKENS = 2500;

/** Estimates the token count of a string using the {@link CHARS_PER_TOKEN} heuristic. */
export function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}
