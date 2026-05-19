/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type BasePromptElementProps, type PromptElementCtor, renderPrompt } from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { SYSTEM_DEFENSE_RULES } from '../../../utils/aiDefenseRules';
import {
    extractJsonObject,
    type GetSelectedModelOptions,
    getSelectedModel as getSelectedModelShared,
    logLlmTokenUsage,
} from '../../../utils/aiUtils';
import { MIGRATION_SELECTED_MODEL_KEY } from '../../../utils/modelUtils';
import {
    type DebugPromptConfig,
    dumpDebugPrompt,
    dumpDebugResponse,
    tryLoadPromptOverride,
} from './debugPromptHelpers';

export { createMkDebug, dumpDebugResponse } from './debugPromptHelpers';
/** Re-exported from shared `aiUtils` to avoid churn for existing callers. */
export { extractJsonObject } from '../../../utils/aiUtils';

/**
 * Resolves the AI model for the Migration Assistant.
 *
 * Unlike the chat-participant / query-editor flow (which share
 * {@link SELECTED_MODEL_KEY}), migration has its own persisted preference
 * under {@link MIGRATION_SELECTED_MODEL_KEY} because the assistant may need
 * a higher-capacity model than the user's day-to-day query picker.
 *
 * Accepts the same options as the shared helper; `stateKey` is defaulted
 * to the migration key if the caller doesn't override it.
 */
export function getSelectedModel(options?: GetSelectedModelOptions): Promise<vscode.LanguageModelChat> {
    return getSelectedModelShared({
        ...options,
        stateKey: options?.stateKey ?? MIGRATION_SELECTED_MODEL_KEY,
    });
}

/**
 * When `true`, rendered prompts are dumped to disk and previously-dumped
 * files are loaded as overrides — enabling rapid prompt iteration at
 * runtime without recompilation.
 *
 * Controlled by the hidden setting `cosmosDB.migration.debugPrompts`
 * (not registered in `package.json` — edit `settings.json` directly to enable).
 * Defaults to `false` for production use.
 */
export function isDebugPromptsEnabled(): boolean {
    return vscode.workspace.getConfiguration('cosmosDB').get<boolean>('migration.debugPrompts', false);
}

/**
 * When `true`, Phase 4 (Target Environment) must be completed before
 * the Start/Plan Migration button is enabled. Set to `false` to allow
 * migration without a configured target environment.
 */
export const IS_PHASE4_REQUIRED = false;

export type { DebugPromptConfig };

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
 * Builds a tool-system message tailored to the specific tools available in this
 * agentic loop. Instead of a static prompt that references tools the model may
 * not have (causing confusion), the builder inspects the actual tool array and
 * only emits guidance relevant to the tools present.
 *
 * Callers can override by passing a custom string as `toolSystemMessage` to
 * `runAgenticLoop`, or suppress it entirely by passing `null`.
 */
export function buildToolSystemMessage(tools: vscode.LanguageModelChatTool[]): string {
    const toolNames = new Set(tools.map((t) => t.name));

    const hasListingTools = tools.some((t) => t.name.startsWith('list'));
    const hasSearchTools = toolNames.has('copilot_searchCodebase') || toolNames.has('copilot_findTextInFiles');
    const hasCopilotTools = tools.some((t) => t.name.startsWith('copilot_'));

    const lines: string[] = [
        'You have access to the following tools to help you complete the task:\n',
        ...tools.map((t) => `- **${t.name}**: ${t.description ?? '(no description)'}`),
        '\nFollow these guidelines:\n',
    ];

    let ruleNum = 1;

    if (hasListingTools) {
        lines.push(
            `${ruleNum}. **Discover before you read.** Use listing tools ` +
                `(${tools
                    .filter((t) => t.name.startsWith('list'))
                    .map((t) => '`' + t.name + '`')
                    .join(', ')}) ` +
                'to enumerate available resources and check file sizes before reading them.',
        );
        ruleNum++;
    }

    if (hasSearchTools) {
        lines.push(
            `${ruleNum}. **Prefer search over full reads.** Use search tools to extract only the ` +
                'relevant sections from large files. Only fall back to reading a full file when the ' +
                'content cannot be retrieved via search.',
        );
        ruleNum++;
    }

    if (hasCopilotTools) {
        lines.push(
            `${ruleNum}. **Exclude the migration configuration folder.** When using any \`copilot_*\` tool, ` +
                'always exclude the `.cosmosdb-migration` folder from results. Use an exclude glob such as ' +
                '`**/.cosmosdb-migration/**` to avoid returning generated configuration files.',
        );
        ruleNum++;
    }

    lines.push(
        `${ruleNum}. **Batch tool calls.** You may call multiple tools in a single round. Prefer batching ` +
            'independent reads together rather than issuing them sequentially across rounds.',
    );
    ruleNum++;

    lines.push(
        `${ruleNum}. **Gather sufficient evidence before concluding.** Use tools iteratively until you have ` +
            'enough information to produce a complete and accurate answer. Do not guess when a tool call ' +
            'can provide the answer.',
    );
    ruleNum++;

    lines.push(
        `${ruleNum}. **Final response only.** Intermediate rounds are for tool use only. The response you ` +
            'produce in the final round — when you stop calling tools — is the only output shown to the ' +
            'user. Make it complete and self-contained.',
    );

    return lines.join('\n');
}

export { stripMarkdownPreamble } from './markdownUtils';

/**
 * Renders a prompt with `@vscode/prompt-tsx`, applying a debug prompt override
 * to the first message if one exists on disk. Always refreshes the latest data
 * messages for inspection, and only rewrites the prompt file when no override
 * is active.
 *
 * When `isDebugPromptsEnabled()` and a `debugConfig` is provided:
 *  1. Renders normally via `@vscode/prompt-tsx`
 *  2. Tries to load `{stepName}.prompt.md` — if found, replaces the first message
 *  3. Without an override, dumps `{stepName}.prompt.md` + `{stepName}.messages.md`
 *  4. With an override, preserves `{stepName}.prompt.md` and refreshes `{stepName}.messages.md`
 *
 * The shared `SYSTEM_DEFENSE_RULES` message is prepended AFTER the debug
 * dump/override step so debug files reflect only the phase prompt and data
 * messages — the defense rules are infrastructure and would otherwise bloat
 * dumps and break `{stepName}.prompt.md` ↔ phase-prompt binding needed for
 * override iteration. The returned `messages` array always starts with the
 * defense message so it reaches the model on every call.
 *
 * @returns The rendered (possibly overridden) messages and their token count.
 */
export async function renderWithDebug<P extends BasePromptElementProps>(
    PromptClass: PromptElementCtor<P, unknown>,
    props: P,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    debugConfig?: DebugPromptConfig,
): Promise<{ messages: vscode.LanguageModelChatMessage[]; inputTokenCount: number }> {
    const { messages, tokenCount } = await renderPrompt(
        PromptClass,
        props,
        { modelMaxPromptTokens: model.maxInputTokens },
        model,
        undefined,
        token,
    );

    // Handle debug dump / override BEFORE injecting the defense message so
    // that `{stepName}.prompt.md` stays bound to the phase prompt (index 0
    // of the rendered messages) and dumps don't include the defense rules.
    if (isDebugPromptsEnabled() && debugConfig) {
        const override = await tryLoadPromptOverride(debugConfig.debugDir, debugConfig.stepName);
        if (override && messages.length > 0) {
            messages[0] = override;
        }
        await dumpDebugPrompt(debugConfig.debugDir, debugConfig.stepName, messages, !!override);
    }

    // Prepend the shared defense-rules system message so prompt-injection
    // and content-safety rules apply uniformly across all migration steps.
    // Kept as a separate message ahead of the rendered prompt so individual
    // phase prompts don't each need to inline the rules. The extra input
    // tokens are counted separately (approximated via CHARS_PER_TOKEN) since
    // `renderPrompt`'s budget was already computed against the original TSX.
    const defenseMessage = vscode.LanguageModelChatMessage.User(SYSTEM_DEFENSE_RULES);
    messages.unshift(defenseMessage);
    let inputTokenCount = tokenCount;
    try {
        inputTokenCount += await model.countTokens(defenseMessage, token);
    } catch {
        // Fall back to heuristic if countTokens fails.
        inputTokenCount += Math.ceil(SYSTEM_DEFENSE_RULES.length / 4);
    }

    ext.outputChannel.debug(
        `[Migration] renderWithDebug: ${messages.length} messages, ` +
            `inputTokenCount=${inputTokenCount}, budget=${model.maxInputTokens} ` +
            `(${Math.round((inputTokenCount / model.maxInputTokens) * 100)}%)` +
            (debugConfig ? `, step="${debugConfig.stepName}"` : ''),
    );

    return { messages, inputTokenCount };
}

/**
 * Sends pre-built messages to the model, streams the response, and logs
 * a single consolidated token-usage line combining input/output counts
 * with budget utilization.
 */
async function runPromptFromMessages(
    messages: vscode.LanguageModelChatMessage[],
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    label: string,
    inputTokenCount: number,
    modelOptions?: Record<string, unknown>,
): Promise<string> {
    ext.outputChannel.debug(
        `[Migration] ${label}: sending ${messages.length} messages to model="${model.name}" (${model.family}), ` +
            `inputTokenCount=${inputTokenCount}`,
    );
    const startTime = Date.now();

    const response = await model.sendRequest(
        messages,
        { modelOptions: { ...DEFAULT_MODEL_OPTIONS, ...modelOptions } },
        token,
    );
    let fullText = '';
    for await (const chunk of response.text) {
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        fullText += chunk;
    }

    const elapsed = Date.now() - startTime;
    ext.outputChannel.debug(
        `[Migration] ${label}: response received in ${elapsed}ms, ` + `responseLength=${fullText.length} chars`,
    );

    await logLlmTokenUsage(model, {
        caller: `migration.${label}`,
        inputTokenCount,
        responseText: fullText,
        token,
        logLabel: `Migration / ${label}`,
    });

    return fullText;
}

/**
 * Renders a prompt with `@vscode/prompt-tsx`, sends it to the model, streams
 * the full response text, and logs token usage.
 *
 * @returns The complete response text.
 */
export async function runPrompt<P extends BasePromptElementProps>(
    PromptClass: PromptElementCtor<P, unknown>,
    props: P,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    label: string,
    modelOptions?: Record<string, unknown>,
    debugConfig?: DebugPromptConfig,
): Promise<string> {
    const { messages, inputTokenCount } = await renderWithDebug(PromptClass, props, model, token, debugConfig);

    const fullText = await runPromptFromMessages(messages, model, token, label, inputTokenCount, modelOptions);

    if (isDebugPromptsEnabled() && debugConfig) {
        await dumpDebugResponse(debugConfig.debugDir, debugConfig.stepName, fullText, 'md');
    }

    return fullText;
}

/**
 * Renders a prompt, sends it to the model, extracts a JSON object from
 * the response, and returns the parsed result.
 *
 * @throws If no JSON object is found in the response.
 */
export async function runPromptWithJsonResult<
    T,
    C extends PromptElementCtor<any, unknown> = PromptElementCtor<BasePromptElementProps, unknown>,
>(
    PromptClass: C,
    props: C extends PromptElementCtor<infer P, unknown> ? P : never,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
    label: string,
    errorMessage?: string,
    debugConfig?: DebugPromptConfig,
): Promise<T> {
    const { messages, inputTokenCount } = await renderWithDebug(PromptClass, props, model, token, debugConfig);

    const fullText = await runPromptFromMessages(messages, model, token, label, inputTokenCount, { temperature: 0.1 });

    const jsonString = extractJsonObject(fullText);
    if (!jsonString) {
        const truncated = fullText.length > 300 ? fullText.slice(0, 300) + '…' : fullText;
        ext.outputChannel.appendLog(
            `[${label}] Failed to extract JSON from AI response (${fullText.length} chars). ` +
                `Response preview: "${truncated}"`,
        );
        throw new Error(errorMessage ?? l10n.t('Could not parse AI response.'));
    }

    const parsed = JSON.parse(jsonString) as T;
    ext.outputChannel.debug(
        `[Migration] ${label}: JSON extracted successfully, ` +
            `keys=[${Object.keys(parsed as Record<string, unknown>).join(', ')}]`,
    );

    if (isDebugPromptsEnabled() && debugConfig) {
        await dumpDebugResponse(debugConfig.debugDir, debugConfig.stepName, JSON.stringify(parsed, null, 2), 'json');
    }

    return parsed;
}

/**
 * Agentic variant of {@link runPromptWithJsonResult}.
 *
 * Combines `runAgenticLoop` (tool calling) with JSON extraction. Uses
 * temperature 0.1 for deterministic structured output.
 *
 * @returns The parsed JSON result together with the exhaustion flag so
 *   callers can surface an "incomplete" signal.
 * @throws If no JSON object is found in the final response.
 */
export async function runAgenticLoopWithJsonResult<
    T,
    C extends PromptElementCtor<any, unknown> = PromptElementCtor<BasePromptElementProps, unknown>,
>(
    PromptClass: C,
    props: C extends PromptElementCtor<infer P, unknown> ? P : never,
    model: vscode.LanguageModelChat,
    tools: vscode.LanguageModelChatTool[],
    executeToolCall: (toolCall: vscode.LanguageModelToolCallPart) => Promise<string>,
    maxRounds: number,
    token: vscode.CancellationToken,
    label: string,
    errorMessage?: string,
    debugConfig?: DebugPromptConfig,
): Promise<{ value: T; roundsExhausted: boolean }> {
    const { messages } = await renderWithDebug(PromptClass, props, model, token, debugConfig);

    const { text: fullText, roundsExhausted } = await runAgenticLoop(
        model,
        messages,
        tools,
        executeToolCall,
        maxRounds,
        token,
        label,
        undefined,
        { temperature: 0.1 },
        debugConfig,
    );

    const jsonString = extractJsonObject(fullText);
    if (!jsonString) {
        const truncated = fullText.length > 300 ? fullText.slice(0, 300) + '…' : fullText;
        ext.outputChannel.appendLog(
            `[${label}] Failed to extract JSON from AI response (${fullText.length} chars). ` +
                `Response preview: "${truncated}"`,
        );
        throw new Error(errorMessage ?? l10n.t('Could not parse AI response.'));
    }

    const parsed = JSON.parse(jsonString) as T;
    ext.outputChannel.debug(
        `[Migration] ${label}: JSON extracted successfully (agentic), ` +
            `keys=[${Object.keys(parsed as Record<string, unknown>).join(', ')}]`,
    );

    if (isDebugPromptsEnabled() && debugConfig) {
        await dumpDebugResponse(debugConfig.debugDir, debugConfig.stepName, JSON.stringify(parsed, null, 2), 'json');
    }

    return { value: parsed, roundsExhausted };
}

/**
 * Result of an agentic tool-calling loop.
 *
 * `roundsExhausted` is `true` when the loop exited because `round >= maxRounds`
 * rather than because the model produced a final (non-tool-calling) response.
 * Callers can surface this to users — e.g. append a warning banner to a
 * persisted output file — so the signal survives toast dismissal / panel reload.
 */
export type AgenticLoopResult = {
    text: string;
    roundsExhausted: boolean;
};

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
 * A system message is automatically prepended to `messages` before the first
 * round (when tools are present) to guide the model on tool prioritization and
 * usage strategy. This is built dynamically by {@link buildToolSystemMessage}
 * based on the actual tools provided. Pass a custom string to override it, or
 * `null` to suppress it entirely.
 *
 * @returns An {@link AgenticLoopResult} with the final-round text and an
 *   exhaustion flag so callers can propagate the signal beyond the toast.
 */
export async function runAgenticLoop(
    model: vscode.LanguageModelChat,
    messages: vscode.LanguageModelChatMessage[],
    tools: vscode.LanguageModelChatTool[],
    executeToolCall: (toolCall: vscode.LanguageModelToolCallPart) => Promise<string>,
    maxRounds: number,
    token: vscode.CancellationToken,
    label: string,
    onRound?: (round: number, textChunk: string, isLastRound: boolean) => Promise<void> | void,
    modelOptions?: Record<string, unknown>,
    debugConfig?: DebugPromptConfig,
    toolSystemMessage?: string | null,
): Promise<AgenticLoopResult> {
    // Wrap the entire loop in telemetry so errors, duration, and token usage
    // are always captured — even on unexpected throws. `rethrow` ensures the
    // error still propagates to the calling phase handler.
    const result = await callWithTelemetryAndErrorHandling(
        'cosmosDB.migration.ai.agenticLoopCompleted',
        async (context) => {
            context.errorHandling.rethrow = true;
            context.errorHandling.suppressDisplay = true;
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            context.telemetry.properties.phase = label;
            context.telemetry.properties.modelId = model.id;
            context.telemetry.properties.modelFamily = model.family;
            context.telemetry.properties.modelVendor = model.vendor;

            // Pre-populate issueProperties so unexpected AI errors include context in Report Issue
            context.errorHandling.issueProperties.phase = label;
            context.errorHandling.issueProperties.modelId = model.id;
            context.errorHandling.issueProperties.modelFamily = model.family;

            ext.outputChannel.debug(
                `[Migration] ${label}: agentic loop starting — model="${model.name}" (${model.family}), ` +
                    `tools=[${tools.map((t) => t.name).join(', ')}], maxRounds=${maxRounds}, ` +
                    `initialMessages=${messages.length}`,
            );
            const loopStartTime = Date.now();

            if (tools.length > 0 && toolSystemMessage !== null) {
                // Insert the tool-system message after the defense-rules message (index 0)
                // so `SYSTEM_DEFENSE_RULES` stays at the top — it declares itself as the
                // "most top rules" and must not be displaced by tool-usage guidance.
                const resolvedMessage = toolSystemMessage ?? buildToolSystemMessage(tools);
                const toolSystem = vscode.LanguageModelChatMessage.User(resolvedMessage);
                if (messages.length > 0) {
                    messages.splice(1, 0, toolSystem);
                } else {
                    messages.push(toolSystem);
                }
            }

            let lastRoundText = '';
            let totalRounds = 0;
            let completedNaturally = false;
            let cumulativeInputTokens = 0;
            let cumulativeOutputTokens = 0;
            let lastRoundInputTokens = 0;

            for (let round = 0; round < maxRounds; round++) {
                if (token.isCancellationRequested) return { text: lastRoundText, roundsExhausted: false };
                totalRounds = round + 1;

                const roundStartTime = Date.now();

                // Count input tokens for this round (full messages array sent to the model)
                try {
                    lastRoundInputTokens = 0;
                    for (const msg of messages) {
                        lastRoundInputTokens += await model.countTokens(msg);
                    }
                    cumulativeInputTokens += lastRoundInputTokens;
                } catch {
                    // Token counting may fail; don't block the workflow
                }

                ext.outputChannel.debug(
                    `[Migration] ${label}: round ${round + 1}/${maxRounds} — ` +
                        `messages=${messages.length}, inputTokens=${lastRoundInputTokens}`,
                );

                const response = await model.sendRequest(
                    messages,
                    { tools, modelOptions: { ...DEFAULT_MODEL_OPTIONS, ...modelOptions } },
                    token,
                );

                const textParts: string[] = [];
                const toolCalls: vscode.LanguageModelToolCallPart[] = [];

                for await (const part of response.stream) {
                    if (token.isCancellationRequested) return { text: lastRoundText, roundsExhausted: false };

                    if (part instanceof vscode.LanguageModelTextPart) {
                        textParts.push(part.value);
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        toolCalls.push(part);
                    }
                }

                lastRoundText = textParts.join('');

                // Count output tokens for this round
                try {
                    cumulativeOutputTokens += await model.countTokens(lastRoundText);
                } catch {
                    // Token counting may fail; don't block the workflow
                }

                const isLastRound = toolCalls.length === 0;
                const roundElapsed = Date.now() - roundStartTime;

                ext.outputChannel.debug(
                    `[Migration] ${label}: round ${round + 1} completed in ${roundElapsed}ms — ` +
                        `toolCalls=${toolCalls.length}` +
                        (toolCalls.length > 0 ? ` [${toolCalls.map((tc) => tc.name).join(', ')}]` : '') +
                        `, textLength=${lastRoundText.length}` +
                        (isLastRound ? ' (final round)' : ''),
                );

                if (onRound && textParts.length > 0) {
                    await onRound(round, lastRoundText, isLastRound);
                }

                if (isLastRound) {
                    completedNaturally = true;
                    break;
                }

                // Add assistant message containing all tool calls
                messages.push(
                    vscode.LanguageModelChatMessage.Assistant(
                        toolCalls.map((tc) => new vscode.LanguageModelToolCallPart(tc.callId, tc.name, tc.input)),
                    ),
                );

                // Execute each tool call and add results
                const toolResults: vscode.LanguageModelToolResultPart[] = [];
                for (const toolCall of toolCalls) {
                    const toolStartTime = Date.now();
                    const result = await executeToolCall(toolCall);
                    const toolElapsed = Date.now() - toolStartTime;
                    ext.outputChannel.debug(
                        `[${label}] Tool ${toolCall.name} completed in ${toolElapsed}ms, ` +
                            `resultLength=${result.length} chars`,
                    );
                    toolResults.push(
                        new vscode.LanguageModelToolResultPart(toolCall.callId, [
                            new vscode.LanguageModelTextPart(result),
                        ]),
                    );
                }

                messages.push(vscode.LanguageModelChatMessage.User(toolResults));
            }

            if (!completedNaturally && !token.isCancellationRequested) {
                ext.outputChannel.appendLog(
                    `[${label}] Warning: agentic loop exhausted all ${maxRounds} tool-calling rounds ` +
                        `without the model producing a final response. ` +
                        `The model may need more rounds to complete this task.`,
                );

                // Telemetry: record exhaustion as a separate warning-level event for alerting.
                void callWithTelemetryAndErrorHandling(
                    'cosmosDB.migration.ai.agenticLoopExhausted',
                    (exhaustionCtx) => {
                        exhaustionCtx.telemetry.properties.phase = label;
                        exhaustionCtx.telemetry.properties.modelId = model.id;
                        exhaustionCtx.telemetry.properties.modelFamily = model.family;
                        exhaustionCtx.telemetry.properties.modelVendor = model.vendor;
                        exhaustionCtx.telemetry.properties.maxRounds = String(maxRounds);
                        exhaustionCtx.telemetry.measurements.cumulativeInputTokens = cumulativeInputTokens;
                        exhaustionCtx.telemetry.measurements.cumulativeOutputTokens = cumulativeOutputTokens;
                        exhaustionCtx.errorHandling.suppressDisplay = true;
                    },
                );

                // User-visible warning with an option to open the output channel.
                const showOutput = l10n.t('Show Output');
                void vscode.window
                    .showWarningMessage(
                        l10n.t(
                            'The AI step "{label}" reached the {maxRounds}-round tool-call limit without finishing. Results may be incomplete.',
                            { label, maxRounds },
                        ),
                        showOutput,
                    )
                    .then((choice) => {
                        if (choice === showOutput) {
                            ext.outputChannel.show();
                        }
                    });
            }

            // Log cumulative token usage at the end of the agentic loop
            logAgenticTokenUsage(
                model,
                `${label} (${totalRounds} rounds)`,
                cumulativeInputTokens,
                cumulativeOutputTokens,
                lastRoundInputTokens,
            );

            const loopElapsed = Date.now() - loopStartTime;
            ext.outputChannel.debug(
                `[Migration] ${label}: agentic loop finished — ` +
                    `rounds=${totalRounds}/${maxRounds}, elapsed=${loopElapsed}ms, ` +
                    `completedNaturally=${String(completedNaturally)}, ` +
                    `responseLength=${lastRoundText.length} chars`,
            );

            // Stamp final metrics on the wrapping telemetry context
            const completionReason = token.isCancellationRequested
                ? 'cancelled'
                : completedNaturally
                  ? 'natural'
                  : 'exhausted';
            context.telemetry.properties.completionReason = completionReason;
            context.telemetry.measurements.cumulativeInputTokens = cumulativeInputTokens;
            context.telemetry.measurements.cumulativeOutputTokens = cumulativeOutputTokens;
            context.telemetry.measurements.totalRounds = totalRounds;
            context.telemetry.measurements.durationMs = loopElapsed;

            if (isDebugPromptsEnabled() && debugConfig && lastRoundText) {
                await dumpDebugResponse(debugConfig.debugDir, debugConfig.stepName, lastRoundText, 'md');
            }

            return { text: lastRoundText, roundsExhausted: !completedNaturally && !token.isCancellationRequested };
        },
    );

    // callWithTelemetryAndErrorHandling returns undefined on error (after rethrowing),
    // but since rethrow is set the error will propagate before we reach here.
    return result!;
}

/**
 * Logs cumulative token usage across all rounds of an agentic loop.
 *
 * Input and output tokens are accumulated per-round inside `runAgenticLoop`
 * because each round sends the full (growing) messages array to the model,
 * meaning the total input cost is the sum across rounds — not just the final
 * snapshot. The budget percentage uses `lastRoundInputTokens` (the peak/final
 * round) since that reflects how close the context window came to truncation.
 */
function logAgenticTokenUsage(
    model: vscode.LanguageModelChat,
    label: string,
    cumulativeInputTokens: number,
    cumulativeOutputTokens: number,
    lastRoundInputTokens: number,
): void {
    try {
        const total = cumulativeInputTokens + cumulativeOutputTokens;
        const budget = model.maxInputTokens;
        const pct = budget > 0 ? Math.round((lastRoundInputTokens / budget) * 100) : 0;

        const base = `[Migration] ${label}: input=${cumulativeInputTokens}, output=${cumulativeOutputTokens}, total=${total} (last round ${pct}% of ${budget} budget)`;

        if (pct >= 100) {
            ext.outputChannel.error(`${base} — ❌ BUDGET EXCEEDED, prompt content was truncated`);
        } else if (pct >= 90) {
            ext.outputChannel.warn(`${base} — ⚠ NEAR LIMIT, content may be truncated`);
        } else {
            ext.outputChannel.appendLog(base);
        }
    } catch {
        // Token counting may fail; don't block the workflow
    }
}
