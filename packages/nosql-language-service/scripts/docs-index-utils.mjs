/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Shared helpers for generating and checking src/docs/index.ts.
//
// Used by:
//   - scripts/generate-docs-index.mjs  (writes the file)
//   - scripts/check-docs-index.mjs     (verifies it's up to date)
// ---------------------------------------------------------------------------

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const docsRoot = path.resolve(__dirname, '..', 'src', 'docs');
export const outFile = path.join(docsRoot, 'index.ts');

/**
 * Read all .md files from a directory tree.
 * Returns Map<UPPER_NAME, content>.
 */
export function collectMdFiles(dir) {
    /** @type {Map<string, string>} */
    const result = new Map();
    if (!fs.existsSync(dir)) return result;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            for (const [k, v] of collectMdFiles(fullPath)) {
                result.set(k, v);
            }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const name = path.basename(entry.name, '.md').toUpperCase();
            result.set(name, fs.readFileSync(fullPath, 'utf-8'));
        }
    }
    return result;
}

/**
 * Escape a string for embedding inside a JS template literal.
 */
export function escapeForTemplate(text) {
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/**
 * Generate the full TypeScript source for src/docs/index.ts
 * from the .md files on disk.
 */
export function generateDocsIndexContent() {
    const functionDocs = collectMdFiles(path.join(docsRoot, 'functions'));
    const keywordDocs = collectMdFiles(path.join(docsRoot, 'keywords'));

    const sortedFunctions = [...functionDocs.entries()].sort(([a], [b]) => a.localeCompare(b));
    const sortedKeywords = [...keywordDocs.entries()].sort(([a], [b]) => a.localeCompare(b));

    const lines = [
        '/*---------------------------------------------------------------------------------------------',
        ' *  Copyright (c) Microsoft Corporation. All rights reserved.',
        ' *  Licensed under the MIT License. See License.txt in the project root for license information.',
        ' *--------------------------------------------------------------------------------------------*/',
        '',
        '// ⚠️  AUTO-GENERATED — do not edit manually.',
        '// Re-generate with:  node scripts/generate-docs-index.mjs',
        '',
        '/** Hover documentation for built-in functions (key = uppercase function name). */',
        'export const functionDocs = new Map<string, string>([',
    ];

    for (const [name, content] of sortedFunctions) {
        lines.push(`    [${JSON.stringify(name)}, \`${escapeForTemplate(content.trimEnd())}\`],`);
    }

    lines.push(']);', '');

    lines.push('/** Hover documentation for SQL keywords (key = uppercase keyword name). */');
    lines.push('export const keywordDocs = new Map<string, string>([');

    for (const [name, content] of sortedKeywords) {
        lines.push(`    [${JSON.stringify(name)}, \`${escapeForTemplate(content.trimEnd())}\`],`);
    }

    lines.push(']);', '');

    return lines.join('\n');
}

