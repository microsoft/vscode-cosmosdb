/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const MARKDOWN_LINK_RE = /\[.*?\]\(.*?\)/;

/**
 * Strips any preamble text before the first Markdown heading. The LLM
 * sometimes emits transitional text (e.g. "Now I have a thorough understanding…")
 * before the actual document. This function detects the first line starting with
 * `#` and removes everything before it.
 *
 * Returns the original text unchanged if no Markdown heading is found.
 */
export function stripMarkdownPreamble(text: string): string {
    const match = text.match(/^(#+\s)/m);
    if (!match || match.index === undefined || match.index === 0) {
        return text;
    }
    return text.slice(match.index);
}

/**
 * Parses a filled-in access-patterns.md and extracts the table/entity names
 * from rows that contain at least one markdown file link (code evidence).
 *
 * The template uses pipe-delimited table rows like:
 * | R001 | Get order by ID | Orders, OrderItems | ... | ... | ... | [OrderRepo.ts](../../src/...) |
 *
 * A row is considered code-evidenced if ANY cell contains a markdown link.
 * Table names are extracted from the "Tables / Entities" column (3rd field).
 */
export function parseCodeEvidencedTables(mdContent: string): string[] {
    const tables = new Set<string>();
    const lines = mdContent.split('\n');

    for (const line of lines) {
        // Must be a pipe-delimited table row (not a header separator)
        if (!line.includes('|') || /^\s*\|[\s-:|]+\|\s*$/.test(line)) continue;

        // Must contain a markdown link somewhere in the row
        if (!MARKDOWN_LINK_RE.test(line)) continue;

        // Split into cells (trim outer pipes)
        const cells = line.split('|').map((c) => c.trim());
        // Pipe-split with leading/trailing pipes gives empty first/last elements
        const filteredCells = cells.filter((c) => c.length > 0);

        // Need at least 3 columns: ID, Pattern Name, Tables/Entities
        if (filteredCells.length < 3) continue;

        // The first cell must look like a pattern ID (R### or W###)
        if (!/^[RW]\d{3}\b/.test(filteredCells[0])) continue;

        // Third column = Tables / Entities
        const tablesCell = filteredCells[2];
        for (const table of tablesCell.split(',')) {
            const trimmed = table.trim();
            if (trimmed.length > 0) {
                tables.add(trimmed);
            }
        }
    }

    return Array.from(tables);
}
