/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';

// ─── Types ───────────────────────────────────────────────────────────

export interface DebugPromptConfig {
    /** Absolute path to the debug-prompts directory for the current phase/domain. */
    debugDir: string;
    /** Kebab-case step name used as filename prefix (e.g. 'step1-analysis'). */
    stepName: string;
    /**
     * Whether prompt/response dumps should actually be written to disk.
     * The config is always produced (so `stepName` is available at runtime for
     * e.g. deterministic test routing), but dumps are gated on this flag.
     */
    dumpEnabled: boolean;
}

// ─── Serialization ──────────────────────────────────────────────────

/**
 * HTML-comment delimiters used to separate messages in the markdown dump.
 * Using `<!-- MSG:Role -->` instead of `## Role` headers avoids ambiguity
 * when prompt content itself contains markdown headings.
 */
const MSG_DELIMITER = '\n\n---\n\n';

/**
 * Serializes rendered messages to a human-readable markdown format.
 * Each message is delimited by `<!-- MSG:User -->` or `<!-- MSG:Assistant -->`
 * comment markers, separated by `---`.
 */
function messagesToMarkdown(messages: vscode.LanguageModelChatMessage[]): string {
    return messages
        .map((msg) => {
            const role = messageRole(msg);
            const content = prettifyEmbeddedJson(extractTextContent(msg));
            return `<!-- MSG:${role} -->\n\n${content}`;
        })
        .join(MSG_DELIMITER);
}

// ─── Deserialization ────────────────────────────────────────────────

/**
 * Parses a single-message markdown file back into a LanguageModelChatMessage.
 * The file content is treated as the text body of a User message.
 */
function markdownToMessage(content: string): vscode.LanguageModelChatMessage | null {
    const trimmed = content.trim();
    return trimmed.length > 0 ? vscode.LanguageModelChatMessage.User(trimmed) : null;
}

// ─── Dump & Load ────────────────────────────────────────────────────

/**
 * Writes debug prompt files to disk:
 *  - When no override is active, writes `{stepName}.prompt.md` from the first
 *    rendered message and `{stepName}.messages.md` from the remaining messages.
 *  - When an override is active, preserves the existing `{stepName}.prompt.md`
 *    file and refreshes only `{stepName}.messages.md`.
 */
export async function dumpDebugPrompt(
    debugDir: string,
    stepName: string,
    messages: vscode.LanguageModelChatMessage[],
    promptOverrideActive = false,
): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(debugDir));

    const promptPath = path.join(debugDir, `${stepName}.prompt.md`);
    const messagesPath = path.join(debugDir, `${stepName}.messages.md`);

    const [first, ...rest] = messages;
    const promptContent = first ? prettifyEmbeddedJson(extractTextContent(first)) : '';
    const messagesContent = rest.length > 0 ? messagesToMarkdown(rest) : '';

    const writes: Thenable<void>[] = [
        vscode.workspace.fs.writeFile(vscode.Uri.file(messagesPath), Buffer.from(messagesContent, 'utf-8')),
    ];

    if (!promptOverrideActive) {
        writes.unshift(vscode.workspace.fs.writeFile(vscode.Uri.file(promptPath), Buffer.from(promptContent, 'utf-8')));
    }

    await Promise.all(writes);

    ext.outputChannel.appendLog(
        promptOverrideActive
            ? `[DEBUG] Override active for "${stepName}": refreshed "${stepName}.messages.md" → ${debugDir}`
            : `[DEBUG] Dumped prompt files for "${stepName}" → ${debugDir}`,
    );
}

/**
 * Dumps the model's response to disk.
 *  - Text responses → `{stepName}.response.md`
 *  - JSON responses → `{stepName}.response.json`
 */
export async function dumpDebugResponse(
    debugDir: string,
    stepName: string,
    responseText: string,
    format: 'md' | 'json',
): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(debugDir));

    const responsePath = path.join(debugDir, `${stepName}.response.${format}`);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(responsePath), Buffer.from(responseText, 'utf-8'));
}

/**
 * Attempts to load a prompt override from `{stepName}.prompt.md`.
 *
 * Only the first message (prompt template) is overridden — remaining data
 * messages are always freshly rendered. Returns `null` if no override exists.
 */
export async function tryLoadPromptOverride(
    debugDir: string,
    stepName: string,
): Promise<vscode.LanguageModelChatMessage | null> {
    const promptPath = path.join(debugDir, `${stepName}.prompt.md`);

    try {
        const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(promptPath))).toString('utf-8');
        const message = markdownToMessage(content);
        if (message) {
            ext.outputChannel.appendLog(
                `[DEBUG] ⚠️ OVERRIDE ACTIVE for "${stepName}": loaded from "${stepName}.prompt.md"`,
            );
            return message;
        }
    } catch {
        // File doesn't exist — no override available
    }

    return null;
}

// ─── Utilities ──────────────────────────────────────────────────────

/**
 * Creates a `mkDebug` helper bound to a specific debug directory.
 * Always returns a {@link DebugPromptConfig} so `stepName` is available at
 * runtime; the `dumpEnabled` flag reflects whether dumps should be written.
 *
 * Usage:
 * ```ts
 * const mkDebug = createMkDebug(debugEnabled, debugDir);
 * await runPrompt(..., mkDebug('step1-analysis'));
 * ```
 */
export function createMkDebug(debugEnabled: boolean, debugDir: string): (stepName: string) => DebugPromptConfig {
    return (stepName: string) => ({ debugDir, stepName, dumpEnabled: debugEnabled });
}

/**
 * Converts a label string to a kebab-case filename.
 * e.g. `'Assessment Phase 1 (Access Pattern Extraction)'` → `'assessment-phase-1-access-pattern-extraction'`
 */
export function sanitizeStepName(label: string): string {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/** Returns 'User' or 'Assistant' for a chat message. */
function messageRole(msg: vscode.LanguageModelChatMessage): 'User' | 'Assistant' {
    return msg.role === vscode.LanguageModelChatMessageRole.User ? 'User' : 'Assistant';
}

/**
 * Detects compact JSON objects/arrays embedded in text and pretty-prints them
 * for readability in debug output files.
 */
function prettifyEmbeddedJson(text: string): string {
    return text.replace(/(?<=\n|^)(\{[\s\S]*?\}|\[[\s\S]*?\])(?=\n|$)/g, (match) => {
        try {
            const parsed: unknown = JSON.parse(match);
            return JSON.stringify(parsed, null, 2);
        } catch {
            return match;
        }
    });
}

/**
 * Extracts the plain-text content from a LanguageModelChatMessage.
 * The message may contain LanguageModelTextPart instances; we concatenate their values.
 */
function extractTextContent(msg: vscode.LanguageModelChatMessage): string {
    const parts: string[] = [];
    for (const part of msg.content) {
        if (part instanceof vscode.LanguageModelTextPart) {
            parts.push(part.value);
        }
    }
    return parts.join('');
}
