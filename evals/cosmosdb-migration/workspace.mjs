/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSha256 } from '../../skills/cosmosdb-migration/scripts/freshness.mjs';

export const temporaryWorkspace = () => mkdtempSync(join(realpathSync(tmpdir()), 'migration-eval-'));

export function fileStamp(file) {
    return `${lstatSync(file).mode & 0o111}:${fileSha256(file)}`;
}

export function snapshot(root) {
    const entries = new Map();
    function walk(relative) {
        const file = join(root, relative);
        const stat = lstatSync(file);
        if (stat.isDirectory()) {
            entries.set(relative, 'directory');
            for (const name of readdirSync(file)) walk(relative ? `${relative}/${name}` : name);
        } else {
            assert.ok(stat.isFile(), `Unexpected link or special file: ${relative}`);
            entries.set(relative, fileStamp(file));
        }
    }
    walk('');
    return entries;
}
