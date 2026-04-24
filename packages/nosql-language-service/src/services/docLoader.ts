/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Provides hover documentation for built-in functions and SQL keywords.
//
// The data is statically embedded in ../docs/index.ts (auto-generated from
// .md files by `node scripts/generate-docs-index.mjs`). This avoids any
// runtime filesystem access and works in both Node.js and browser contexts.
// ---------------------------------------------------------------------------

import { functionDocs, keywordDocs } from '../docs/index.js';

/**
 * Return the markdown documentation for a built-in function,
 * or `undefined` if no doc file exists.
 */
export function getFunctionDoc(name: string): string | undefined {
    return functionDocs.get(name.toUpperCase());
}

/**
 * Return the markdown documentation for a SQL keyword,
 * or `undefined` if no doc file exists.
 */
export function getKeywordDoc(name: string): string | undefined {
    return keywordDocs.get(name.toUpperCase());
}
