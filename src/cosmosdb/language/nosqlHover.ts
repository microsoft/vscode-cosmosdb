/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared hover content logic for CosmosDB NoSQL query language.
 *
 * Environment-agnostic — imports neither `vscode` nor `monaco-editor`.
 * Consumed by both the VS Code hover provider and the Monaco hover provider.
 */

import { type JSONSchema } from '../../utils/json/JSONSchema';
import { NOSQL_FUNCTIONS, NOSQL_KEYWORDS } from './nosqlLanguageDefinitions';
import { getOccurrence, getTypeLabel } from './nosqlParser';

export interface NoSqlHoverContent {
    /** Markdown string to display in the hover popup. */
    markdown: string;
}

/**
 * Returns hover content for the given word, or null if the word is not a
 * known NoSQL keyword or function.
 *
 * Lookup is case-insensitive to match the query language behaviour.
 *
 * @param word - The word under the cursor (no surrounding whitespace).
 */
export function getNoSqlHoverContent(word: string): NoSqlHoverContent | null {
    const upper = word.toUpperCase();

    // ── Keywords ──────────────────────────────────────────────────────────────
    // A single word may be part of a multi-word keyword (e.g. "ORDER" in "ORDER BY").
    // We match single-word keywords exactly and also show multi-word keywords that
    // start with or contain the hovered word.
    const keywordMatch = NOSQL_KEYWORDS.find((k) => k.name.toUpperCase() === upper);
    if (keywordMatch) {
        const lines: string[] = [
            `**${keywordMatch.name}** &nbsp;<small>keyword</small>`,
            '---',
            keywordMatch.description,
            `<a href="${keywordMatch.link}">ⓘ Documentation</a>`,
        ];
        return { markdown: lines.join('\n\n') };
    }

    // Handle multi-word keyword tokens — e.g. hovering "ORDER" should surface "ORDER BY"
    const partialMatches = NOSQL_KEYWORDS.filter(
        (k) => k.name.includes(' ') && k.name.split(' ').some((token) => token.toUpperCase() === upper),
    );
    if (partialMatches.length > 0) {
        const lines: string[] = [
            `**${upper}** &nbsp;<small>keyword</small>`,
            '---',
            ...partialMatches.map(
                (k) => `- **${k.name}** — ${k.description}  \n  <a href="${k.link}">ⓘ Documentation</a>`,
            ),
        ];
        return { markdown: lines.join('\n\n') };
    }

    // ── Functions ─────────────────────────────────────────────────────────────
    const funcMatch = NOSQL_FUNCTIONS.find((f) => f.name.toUpperCase() === upper);
    if (funcMatch) {
        const argDocs = funcMatch.arguments
            .map((a) => `- \`${a.name}\` *(${a.type}${a.optional ? ', optional' : ''})*`)
            .join('\n');

        const lines: string[] = [
            `**${funcMatch.name}** &nbsp;<small>function</small>`,
            '---',
            `\`\`\`nosql\n${funcMatch.signature}\n\`\`\``,
            funcMatch.description,
        ];

        if (argDocs) {
            lines.push('**Parameters:**\n' + argDocs);
        }

        lines.push(`<a href="${funcMatch.link}">ⓘ Documentation</a>`);

        return { markdown: lines.join('\n\n') };
    }

    return null;
}

/**
 * Builds hover content for a schema property (dot-path navigation in the query editor).
 *
 * Shows:
 * - Property name and inferred type(s)
 * - Occurrence count and percentage relative to documents inspected
 * - Per-type occurrence breakdown when the property has mixed types (anyOf)
 * - "sparse" indicator when the property is absent in some documents
 *
 * @param propSchema         - The JSONSchema for the property
 * @param propertyName       - The bare property name (last segment of the path)
 * @param documentsInspected - Root-level `x-documentsInspected` value for percentage calc
 */
export function getNoSqlSchemaPropertyHoverContent(
    propSchema: JSONSchema,
    propertyName: string,
    documentsInspected?: number,
): NoSqlHoverContent {
    const typeLabel = getTypeLabel(propSchema);
    const occurrence = getOccurrence(propSchema);

    const lines: string[] = [`**${propertyName}** &nbsp;<small>property</small>`, '---'];

    // Primary type
    lines.push(`Type: \`${typeLabel}\``);

    // Occurrence / sparseness
    if (documentsInspected && documentsInspected > 0) {
        const pct = Math.round((occurrence / documentsInspected) * 100);
        const sparseTag = pct < 100 ? ' &nbsp;<small>sparse</small>' : '';
        lines.push(`Occurrence: ${occurrence} / ${documentsInspected} documents (${pct}%)${sparseTag}`);
    } else if (occurrence > 0) {
        lines.push(`Occurrence: ${occurrence} documents`);
    }

    // Per-type breakdown for mixed-type properties
    if (propSchema.anyOf) {
        const breakdown = (propSchema.anyOf as JSONSchema[])
            .filter((e) => e.type)
            .map((e) => {
                const t = e.type as string;
                const occ = getOccurrence(e);
                return occ > 0 ? `\`${t}\` (${occ})` : `\`${t}\``;
            });
        if (breakdown.length > 1) {
            lines.push(`Types: ${breakdown.join(', ')}`);
        }
    }

    return { markdown: lines.join('\n\n') };
}
