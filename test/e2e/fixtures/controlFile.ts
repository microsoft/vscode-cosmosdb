/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared fixture helpers for the file-based e2e AI mock control files.
 *
 * The Playwright worker and the extension host share a per-worker directory;
 * writing a small JSON file there tells the extension's offline mock what to do.
 * These primitives centralize the fs plumbing so each fixture (Generate Query,
 * and — eventually — migration) only owns its own control shape.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

/** Writes `contents` as JSON to `<dir>/<file>`, creating `dir` if needed. */
export function writeJsonControl(dir: string, file: string, contents: unknown): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, file), JSON.stringify(contents));
}

/** Removes `<dir>/<file>` (best-effort) so nothing leaks between specs. */
export function clearJsonControl(dir: string, file: string): void {
    try {
        rmSync(path.join(dir, file), { force: true });
    } catch {
        // Best-effort cleanup.
    }
}
