/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { ext } from '../../extensionVariables';

// ─── SKILL.md (overview / index) ────────────────────────────────────

/**
 * Returns Cosmos DB best practices content from the embedded skill file
 * (`skills/cosmosdb-best-practices/SKILL.md`). The content is lazily read
 * from disk on first access and cached for the lifetime of the extension.
 */
let cachedBestPractices: string | undefined;

export function getCosmosDbBestPractices(): string {
    if (cachedBestPractices === undefined) {
        try {
            cachedBestPractices = fs.readFileSync(
                path.join(ext.context.extensionPath, 'skills', 'cosmosdb-best-practices', 'SKILL.md'),
                'utf-8',
            );
        } catch (error) {
            ext.outputChannel.warn(
                `[Migration] Failed to load Cosmos DB best practices skill: ${error instanceof Error ? error.message : String(error)}`,
            );
            cachedBestPractices = '';
        }
    }
    return cachedBestPractices;
}

// ─── Eagerly-loaded critical rules ──────────────────────────────────
//
// Some rules are too important to leave to the model's discretion via
// `loadSkillSupplementaryFile`. Empirically, models in single-pass JSON-output
// prompts skip optional tool calls — even when marked MANDATORY — because the
// terminal "respond with JSON only" directive short-circuits tool selection.
// For rules whose violation produces a hard runtime failure (e.g. invalid
// indexing path syntax causing BadRequest on container creation), we inline
// the content directly into the prompt instead of asking the model to fetch it.

let cachedIndexPathSyntaxRule: string | undefined;

/**
 * Returns the contents of `rules/index-path-syntax.md`, eagerly loaded and
 * cached. Inlined into indexing-related prompts as a guaranteed reference to
 * prevent invalid path notations (`/*` mid-path) that cause container creation
 * to fail with a BadRequest error.
 */
export function getIndexPathSyntaxRule(): string {
    if (cachedIndexPathSyntaxRule === undefined) {
        try {
            cachedIndexPathSyntaxRule = fs.readFileSync(
                path.join(
                    ext.context.extensionPath,
                    'skills',
                    'cosmosdb-best-practices',
                    'rules',
                    'index-path-syntax.md',
                ),
                'utf-8',
            );
        } catch (error) {
            ext.outputChannel.warn(
                `[Migration] Failed to load index-path-syntax rule: ${error instanceof Error ? error.message : String(error)}`,
            );
            cachedIndexPathSyntaxRule = '';
        }
    }
    return cachedIndexPathSyntaxRule;
}

// ─── Skill supplementary files ──────────────────────────────────────

/**
 * Reads a supplementary file that lives alongside a SKILL.md file.
 *
 * @param skillPath Extension-relative path to the SKILL.md
 *                  (e.g. `skills/cosmosdb-best-practices/SKILL.md`).
 * @param supplementaryFile Path relative to the skill folder
 *                          (e.g. `rules/partition-high-cardinality.md`).
 * @returns The file content or an error string when the file cannot be found.
 */
export function loadSkillSupplementaryFile(skillPath: string, supplementaryFile: string): string {
    // Validate: reject path traversal sequences
    if (supplementaryFile.includes('..') || supplementaryFile.startsWith('/')) {
        return `Error: Invalid supplementary file path "${supplementaryFile}". Relative paths only, no "..".`;
    }

    const skillDir = path.dirname(path.join(ext.context.extensionPath, skillPath));
    const filePath = path.join(skillDir, supplementaryFile);

    // Ensure the resolved path remains within the skill directory
    if (!filePath.startsWith(skillDir + path.sep) && filePath !== skillDir) {
        return `Error: Path "${supplementaryFile}" escapes the skill directory.`;
    }

    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return `Error: File "${supplementaryFile}" not found in skill "${path.dirname(skillPath)}".`;
    }
}
