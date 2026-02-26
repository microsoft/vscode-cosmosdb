/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { renderPrompt } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { SELECTED_MODEL_KEY } from '../../../utils/modelUtils';
import { type DebugPromptConfig, dumpDebugPrompt, tryLoadOverrideMessages } from './debugPromptHelpers';

/**
 * When `true`, rendered prompts are dumped to disk and previously-dumped
 * files are loaded as overrides — enabling rapid prompt iteration at
 * runtime without recompilation. Set to `false` for production.
 */
export const DEBUG_PROMPTS_ENABLED = true;

export type { DebugPromptConfig };

/**
 * Resolves the selected AI model from Copilot, using the user's saved preference
 * or falling back to the first available model.
 */
export async function getSelectedModel(): Promise<vscode.LanguageModelChat> {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) {
        throw new Error(l10n.t('No language models available. Please ensure you have access to Copilot.'));
    }

    const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);
    return savedModelId ? (models.find((m) => m.id === savedModelId) ?? models[0]) : models[0];
}

/**
 * Default model options applied to all migration AI requests.
 *
 * Temperature controls randomness in token selection:
 *  - 0.0       — Nearly deterministic; always picks the highest-probability token.
 *  - 0.1       — Minimal variance; best for structured output (JSON, code).
 *  - 0.1–0.3   — Low variance; suited for analytical/classification tasks (domain decomposition, schema mapping).
 *  - 0.5–0.7   — Moderate variance; natural for general conversation.
 *  - 0.8–1.0   — High variance; useful for brainstorming and creative exploration.
 *  - >1.0      — Flattens the distribution; increasingly random/incoherent output.
 *
 * The migration pipeline performs analytical tasks (dependency analysis, domain
 * grouping, schema conversion) where consistency across runs matters more than
 * creativity. A default of 0.2 provides stable results while allowing slight
 * variation to avoid degenerate outputs.
 *
 * Callers can override via the `modelOptions` parameter — for example,
 * `runPromptWithJsonResult` lowers temperature to 0.1 for JSON output.
 *
 * Upstream model temperature defaults (when NOT specified via API):
 *  - GPT-4o / GPT-4o-mini / GPT-4 / GPT-4-turbo — Default: 1.0, range 0.0–2.0.
 *    Source: https://developers.openai.com/api/reference/resources/completions/methods/create (search for temperature parameter)
 *  - Claude 3.5 Sonnet / Opus — Default: 1.0, range 0.0–1.0.
 *    Source: https://platform.claude.com/docs/en/api/messages/create#create.temperature
 *  - o1 / o3-mini (reasoning models) — Temperature is fixed at 1.0; parameter not accepted.
 *    Source: https://platform.openai.com/docs/guides/reasoning#limitations
 *
 * IMPORTANT: These are the upstream API defaults. The Copilot provider acts as a
 * proxy and may or may not forward `modelOptions` to the underlying model. The
 * VS Code `modelOptions` docs state: "These options are specific to the language
 * model and need to be looked up in the respective documentation." There is no
 * guarantee that the Copilot proxy preserves these values as-is. If unsupported,
 * the options are silently ignored (no error).
 */
const DEFAULT_MODEL_OPTIONS: Record<string, unknown> = { temperature: 0.2 };

/**
 * Renders a prompt with `@vscode/prompt-tsx`, sends it to the model, streams
 * the full response text, and logs token usage.
 *
 * @returns The complete response text.
 */
export async function runPrompt(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PromptClass: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    props: any,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    label?: string,
    modelOptions?: Record<string, unknown>,
    debugConfig?: DebugPromptConfig,
): Promise<string> {
    let messages: vscode.LanguageModelChatMessage[];

    if (DEBUG_PROMPTS_ENABLED && debugConfig) {
        const override = await tryLoadOverrideMessages(
            debugConfig.debugDir,
            debugConfig.stepName,
            PromptClass,
            model,
            token,
        );
        if (override) {
            messages = override;
        } else {
            ({ messages } = await renderPrompt(
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                PromptClass,
                props,
                { modelMaxPromptTokens: model.maxInputTokens },
                model,
                undefined,
                token,
            ));
            await dumpDebugPrompt(debugConfig.debugDir, debugConfig.stepName, messages, props);
        }
    } else {
        ({ messages } = await renderPrompt(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            PromptClass,
            props,
            { modelMaxPromptTokens: model.maxInputTokens },
            model,
            undefined,
            token,
        ));
    }

    const response = await model.sendRequest(
        messages,
        { modelOptions: { ...DEFAULT_MODEL_OPTIONS, ...modelOptions } },
        token,
    );
    let fullText = '';
    for await (const chunk of response.text) {
        if (token.isCancellationRequested) throw new Error('Cancelled');
        fullText += chunk;
    }

    if (label) {
        await logTokenUsage(model, label, messages, fullText);
    }

    return fullText;
}

/**
 * Renders a prompt, sends it to the model, extracts a JSON object from
 * the response, and returns the parsed result.
 *
 * @throws If no JSON object is found in the response.
 */
export async function runPromptWithJsonResult<T>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PromptClass: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    props: any,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    label?: string,
    errorMessage?: string,
    debugConfig?: DebugPromptConfig,
): Promise<T> {
    const fullText = await runPrompt(PromptClass, props, model, token, label, { temperature: 0.1 }, debugConfig);

    const jsonMatch = fullText.match(/\{[\s\S]*\}/s);
    if (!jsonMatch) {
        throw new Error(errorMessage ?? l10n.t('Could not parse AI response.'));
    }

    return JSON.parse(jsonMatch[0]) as T;
}

/**
 * Generic agentic tool-calling loop. Sends messages to the model with the
 * provided tools; when the model calls a tool, executes it via `executeToolCall`
 * and feeds results back. Repeats for up to `maxRounds`.
 *
 * Intermediate text produced during tool-calling rounds is forwarded to the
 * optional `onRound` callback (e.g. for progress reporting) but is excluded
 * from the return value. Only the text from the final round — when the model
 * stops calling tools and produces the conclusive result — is returned.
 *
 * The `onRound` callback receives an `isLastRound` flag that is `true` when
 * the model produced no tool calls, indicating the loop is about to end.
 *
 * @returns The text output from the final (non-tool-calling) round.
 */
export async function runAgenticLoop(
    model: vscode.LanguageModelChat,
    messages: vscode.LanguageModelChatMessage[],
    tools: vscode.LanguageModelChatTool[],
    executeToolCall: (toolCall: vscode.LanguageModelToolCallPart) => Promise<string>,
    maxRounds: number,
    token: vscode.CancellationToken,
    onRound?: (round: number, textChunk: string, isLastRound: boolean) => Promise<void>,
    modelOptions?: Record<string, unknown>,
): Promise<string> {
    let lastRoundText = '';

    for (let round = 0; round < maxRounds; round++) {
        if (token.isCancellationRequested) return lastRoundText;

        const response = await model.sendRequest(
            messages,
            { tools, modelOptions: { ...DEFAULT_MODEL_OPTIONS, ...modelOptions } },
            token,
        );

        const textParts: string[] = [];
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];

        for await (const part of response.stream) {
            if (token.isCancellationRequested) return lastRoundText;

            if (part instanceof vscode.LanguageModelTextPart) {
                textParts.push(part.value);
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push(part);
            }
        }

        lastRoundText = textParts.join('');

        const isLastRound = toolCalls.length === 0;

        if (onRound && textParts.length > 0) {
            await onRound(round, lastRoundText, isLastRound);
        }

        if (isLastRound) break;

        // Add assistant message containing all tool calls
        messages.push(
            vscode.LanguageModelChatMessage.Assistant(
                toolCalls.map((tc) => new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input)),
            ),
        );

        // Execute each tool call and add results
        const toolResults: vscode.LanguageModelToolResultPart[] = [];
        for (const toolCall of toolCalls) {
            const result = await executeToolCall(toolCall);
            toolResults.push(
                new vscode.LanguageModelToolResultPart(toolCall.callId, [new vscode.LanguageModelTextPart(result)]),
            );
        }

        messages.push(vscode.LanguageModelChatMessage.User(toolResults));
    }

    return lastRoundText;
}

/**
 * Logs estimated token usage for an AI request to the output channel.
 */
export async function logTokenUsage(
    model: vscode.LanguageModelChat,
    label: string,
    messages: vscode.LanguageModelChatMessage[],
    responseText: string,
): Promise<void> {
    try {
        let inputTokens = 0;
        for (const msg of messages) {
            inputTokens += await model.countTokens(msg);
        }
        const outputTokens = await model.countTokens(responseText);
        ext.outputChannel.appendLog(
            `[Migration] Token usage for ${label}: input=${inputTokens}, output=${outputTokens}, total=${inputTokens + outputTokens}`,
        );
    } catch {
        // Token counting may fail; don't block the workflow
    }
}
