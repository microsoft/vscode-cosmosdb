/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { renderPrompt } from '@vscode/prompt-tsx';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';

// ─── Types ───────────────────────────────────────────────────────────

export interface DebugPromptConfig {
    /** Absolute path to the debug-prompts directory for the current phase/domain. */
    debugDir: string;
    /** Kebab-case step name used as filename prefix (e.g. 'step1-analysis'). */
    stepName: string;
}

interface SerializedMessage {
    role: 'User' | 'Assistant';
    content: string;
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
 * comment markers, separated by `---`. These markers are unambiguous even
 * when the prompt body contains markdown headers (`##`, `###`, etc.).
 */
function messagesToMarkdown(messages: vscode.LanguageModelChatMessage[]): string {
    return messages
        .map((msg) => {
            const role = messageRole(msg);
            const content = extractTextContent(msg);
            return `<!-- MSG:${role} -->\n\n${content}`;
        })
        .join(MSG_DELIMITER);
}

/**
 * Serializes rendered messages to a JSON array of `{ role, content }` objects.
 */
function messagesToJson(messages: vscode.LanguageModelChatMessage[]): string {
    const serialized: SerializedMessage[] = messages.map((msg) => ({
        role: messageRole(msg),
        content: extractTextContent(msg),
    }));
    return JSON.stringify(serialized, null, 2);
}

// ─── Deserialization ────────────────────────────────────────────────

/**
 * Parses a markdown dump back into LanguageModelChatMessage[].
 * Splits on `<!-- MSG:User -->` / `<!-- MSG:Assistant -->` comment markers.
 * Also supports the legacy `## User` / `## Assistant` header format for
 * backward compatibility with previously-dumped files.
 */
function markdownToMessages(content: string): vscode.LanguageModelChatMessage[] {
    const messages: vscode.LanguageModelChatMessage[] = [];

    // Try the HTML-comment format first (preferred)
    const commentSections = content.split(/^<!-- MSG:(User|Assistant) -->\s*$/m);

    if (commentSections.length > 1) {
        // commentSections[0] is text before the first marker (usually empty)
        // then alternating: role, content, role, content, …
        for (let i = 1; i < commentSections.length; i += 2) {
            const role = commentSections[i].trim();
            const body = (commentSections[i + 1] ?? '').trim();
            const cleaned = body
                .replace(/^---\s*/, '')
                .replace(/\s*---$/, '')
                .trim();

            if (role === 'User') {
                messages.push(vscode.LanguageModelChatMessage.User(cleaned));
            } else if (role === 'Assistant') {
                messages.push(vscode.LanguageModelChatMessage.Assistant(cleaned));
            }
        }
        return messages;
    }

    // Fallback: legacy `## User` / `## Assistant` header format
    const headerSections = content.split(/^## (User|Assistant)\s*$/m);
    for (let i = 1; i < headerSections.length; i += 2) {
        const role = headerSections[i].trim();
        const body = (headerSections[i + 1] ?? '').trim();
        const cleaned = body
            .replace(/^---\s*/, '')
            .replace(/\s*---$/, '')
            .trim();

        if (role === 'User') {
            messages.push(vscode.LanguageModelChatMessage.User(cleaned));
        } else if (role === 'Assistant') {
            messages.push(vscode.LanguageModelChatMessage.Assistant(cleaned));
        }
    }

    return messages;
}

/**
 * Parses a JSON dump back into LanguageModelChatMessage[].
 */
function jsonToMessages(content: string): vscode.LanguageModelChatMessage[] {
    const parsed = JSON.parse(content) as SerializedMessage[];
    return parsed.map((m) =>
        m.role === 'User'
            ? vscode.LanguageModelChatMessage.User(m.content)
            : vscode.LanguageModelChatMessage.Assistant(m.content),
    );
}

// ─── Dump & Load ────────────────────────────────────────────────────

/**
 * Writes debug prompt files to disk:
 *  - `{stepName}.messages.md`   — human-readable, editable
 *  - `{stepName}.messages.json` — machine-friendly, editable
 *  - `{stepName}.props.json`    — input props snapshot (data layer)
 */
export async function dumpDebugPrompt(
    debugDir: string,
    stepName: string,
    messages: vscode.LanguageModelChatMessage[],
    props: unknown,
): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(debugDir));

    const mdPath = path.join(debugDir, `${stepName}.messages.md`);
    const jsonPath = path.join(debugDir, `${stepName}.messages.json`);
    const propsPath = path.join(debugDir, `${stepName}.props.json`);

    await Promise.all([
        vscode.workspace.fs.writeFile(vscode.Uri.file(mdPath), Buffer.from(messagesToMarkdown(messages), 'utf-8')),
        vscode.workspace.fs.writeFile(vscode.Uri.file(jsonPath), Buffer.from(messagesToJson(messages), 'utf-8')),
        vscode.workspace.fs.writeFile(vscode.Uri.file(propsPath), Buffer.from(JSON.stringify(props, null, 2), 'utf-8')),
    ]);

    ext.outputChannel.appendLog(`[DEBUG] Dumped prompt files for "${stepName}" → ${debugDir}`);
}

/**
 * Attempts to load override messages from previously dumped debug files.
 *
 * Priority order:
 *  1. `{stepName}.messages.md`  → parse markdown back into messages (full override)
 *  2. `{stepName}.messages.json` → parse JSON back into messages (full override)
 *  3. `{stepName}.props.json`   → re-render prompt with overridden props (data override only)
 *  4. None found → return null (caller should render normally and dump)
 *
 * @returns Overridden messages, or `null` if no override files exist.
 */
export async function tryLoadOverrideMessages(
    debugDir: string,
    stepName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    PromptClass: any,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
): Promise<vscode.LanguageModelChatMessage[] | null> {
    const mdPath = path.join(debugDir, `${stepName}.messages.md`);
    const jsonPath = path.join(debugDir, `${stepName}.messages.json`);
    const propsPath = path.join(debugDir, `${stepName}.props.json`);

    // 1. Try markdown override
    try {
        const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(mdPath))).toString('utf-8');
        const messages = markdownToMessages(content);
        if (messages.length > 0) {
            logOverrideWarning(stepName, `${stepName}.messages.md`, messages.length);
            return messages;
        }
    } catch {
        // File doesn't exist — try next
    }

    // 2. Try JSON override
    try {
        const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(jsonPath))).toString('utf-8');
        const messages = jsonToMessages(content);
        if (messages.length > 0) {
            logOverrideWarning(stepName, `${stepName}.messages.json`, messages.length);
            return messages;
        }
    } catch {
        // File doesn't exist — try next
    }

    // 3. Try props override (re-render with saved props)
    try {
        const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(propsPath))).toString('utf-8');
        const overriddenProps = JSON.parse(content) as Record<string, unknown>;
        const { messages } = await renderPrompt(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            PromptClass,
            overriddenProps,
            { modelMaxPromptTokens: model.maxInputTokens },
            model,
            undefined,
            token,
        );
        logOverrideWarning(stepName, `${stepName}.props.json`, messages.length, true);
        return messages;
    } catch {
        // File doesn't exist — no override available
    }

    return null;
}

// ─── Utilities ──────────────────────────────────────────────────────

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

/**
 * Logs a prominent warning to the output channel when a debug override is active.
 * This makes it immediately obvious that the live prompt is NOT being used.
 */
function logOverrideWarning(stepName: string, fileName: string, messageCount: number, isReRendered?: boolean): void {
    const mode = isReRendered ? 'RE-RENDERED with overridden props from' : 'FULL OVERRIDE loaded from';
    ext.outputChannel.appendLog(
        `[DEBUG] ⚠️ OVERRIDE ACTIVE for "${stepName}": ${mode} "${fileName}" (${messageCount} message${messageCount === 1 ? '' : 's'})`,
    );
}

/** Returns 'User' or 'Assistant' for a chat message. */
function messageRole(msg: vscode.LanguageModelChatMessage): 'User' | 'Assistant' {
    return msg.role === vscode.LanguageModelChatMessageRole.User ? 'User' : 'Assistant';
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
