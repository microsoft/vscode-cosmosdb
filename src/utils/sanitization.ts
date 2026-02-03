/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Security utilities for sanitizing and escaping user-controlled content
 * to prevent XSS and UI injection attacks in VS Code webviews and markdown rendering.
 */

/**
 * HTML entity map for escaping special characters.
 * Defined as a constant to avoid recreation on every function call.
 */
const HTML_ESCAPE_MAP: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * Replaces &, <, >, ", and ' with their HTML entity equivalents.
 *
 * @param text The text to escape
 * @returns The escaped text safe for HTML rendering
 */
export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

/**
 * Escapes Markdown special characters that could be used for injection.
 * This includes characters that have special meaning in Markdown syntax.
 *
 * @param text The text to escape
 * @returns The escaped text safe for markdown rendering
 */
export function escapeMarkdown(text: string): string {
    // Escape markdown special characters
    // Note: We escape these to prevent markdown injection but preserve readability
    return text.replace(/([\\`*_{}[\]()#+\-.!|<>])/g, '\\$1');
}

/**
 * Escapes a string for safe use in VS Code markdown strings by wrapping it in a code block.
 * This is the safest way to display user content as it prevents any markdown interpretation.
 *
 * @param text The text to render as a code block
 * @param inline If true, uses inline code (backticks), otherwise uses a code block
 * @returns The text wrapped in markdown code formatting
 */
export function renderAsCodeBlock(text: string, inline: boolean = true): string {
    if (inline) {
        // For inline code, escape backticks by replacing with escaped backtick
        // This prevents breaking out of the code block while preserving readability
        const escaped = text.replace(/`/g, '\\`');
        return `\`${escaped}\``;
    } else {
        // For code blocks, escape triple backticks to prevent breaking out of the code fence
        // Replaces ``` with ` `` (space breaks the sequence)
        const escaped = text.replace(/```/g, '` `` ');
        return `\`\`\`\n${escaped}\n\`\`\``;
    }
}

/**
 * Sanitizes a potential command URI to prevent command injection.
 * Only allows alphanumeric characters, dots, hyphens, and underscores in command names.
 * This prevents malicious command: URIs from being executed.
 *
 * @param commandUri The command URI to sanitize
 * @returns The sanitized command URI, or null if invalid
 */
export function sanitizeCommandUri(commandUri: string): string | null {
    // Command URIs should follow the pattern: command:commandName
    const commandPattern = /^command:([a-zA-Z0-9._-]+)$/;
    const match = commandUri.match(commandPattern);

    if (!match) {
        return null;
    }

    return commandUri;
}

/**
 * Safely formats user data for display in markdown by escaping special characters.
 * Use this for displaying user-generated strings in markdown contexts where
 * you want to preserve some formatting but prevent injection.
 *
 * @param text The user text to format
 * @returns The safely formatted text
 */
export function safeMarkdownText(text: string): string {
    // First escape HTML to prevent XSS if markdown is rendered as HTML
    let safe = escapeHtml(text);
    // Then escape markdown to prevent markdown injection
    safe = escapeMarkdown(safe);
    return safe;
}

/**
 * Safely displays a JSON object in markdown by serializing and wrapping in a code block.
 * This prevents any XSS or injection attacks from malicious JSON content.
 *
 * @param obj The object to display
 * @param inline If true, uses inline code, otherwise uses a code block
 * @returns The safely formatted JSON
 */
export function safeJsonDisplay(obj: unknown, inline: boolean = true): string {
    try {
        const json = JSON.stringify(obj, null, inline ? 0 : 2);
        return renderAsCodeBlock(json, inline);
    } catch {
        return inline ? '`[invalid JSON]`' : '```\n[invalid JSON]\n```';
    }
}

/**
 * Safely displays an error message in markdown.
 * Escapes the error message and optionally wraps it in formatting.
 *
 * @param error The error to display (Error object or string)
 * @param prefix Optional emoji or prefix to add before the error
 * @returns The safely formatted error message
 */
export function safeErrorDisplay(error: Error | string, prefix: string = '❌'): string {
    const message = error instanceof Error ? error.message : String(error);
    // Escape the error message to prevent injection
    const safeMessage = safeMarkdownText(message);
    return `${prefix} ${safeMessage}`;
}

/**
 * Safely wraps user content in a markdown code block with a specific language.
 * This is useful for displaying SQL queries, code snippets, etc.
 *
 * @param content The content to wrap
 * @param language The language identifier (e.g., 'sql', 'json', 'javascript')
 * @returns The content wrapped in a language-specific code block
 */
export function safeCodeBlock(content: string, language: string = ''): string {
    // Escape triple backticks in the content to prevent breaking out of the code fence
    // Replaces ``` with ` `` (space breaks the sequence)
    const escaped = content.replace(/```/g, '` `` ');
    return `\`\`\`${language}\n${escaped}\n\`\`\``;
}
