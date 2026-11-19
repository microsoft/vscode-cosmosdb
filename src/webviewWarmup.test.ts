/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { glob } from 'glob';
import path from 'node:path';
import { resolveConfig } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
let warmupFiles: string[];

beforeAll(async () => {
    vi.stubEnv('COSMOSDB_WEBVIEW_HOST', '127.0.0.1');
    vi.stubEnv('COSMOSDB_WEBVIEW_PORT', '18082');
    vi.stubEnv('COSMOSDB_WEBVIEW_ORIGIN', 'http://127.0.0.1:18082');
    const config = await resolveConfig(
        { root, configFile: path.join(root, 'vite.config.views.mjs'), mode: 'development', logLevel: 'silent' },
        'serve',
    );
    const patterns = config.server.warmup.clientFiles;
    if (!patterns?.length) {
        throw new Error('Expected browser warmup patterns in the webview Vite configuration.');
    }
    // glob uses an ignore option for the negated patterns that Vite accepts in its warmup list.
    warmupFiles = await glob(
        patterns.filter((pattern) => !pattern.startsWith('!')),
        {
            cwd: root,
            ignore: patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1)),
            nodir: true,
            posix: true,
        },
    );
});

afterAll(() => vi.unstubAllEnvs());

describe('webview browser warmup', () => {
    it('does not warm the migration test that imports host-only filesystem helpers', () => {
        expect(warmupFiles).not.toContain('src/webviews/cosmosdb/Migration/state/deriveMigrationPhaseStates.test.ts');
    });

    it('excludes test and mock modules in both webviews and workspace packages', () => {
        expect(
            warmupFiles.find((file) => /(?:^|\/)__(?:tests|mocks)__\/|\.(?:test|spec)\.tsx?$/.test(file)),
        ).toBeUndefined();
    });

    it('still warms browser production modules and workspace dependencies', () => {
        expect(warmupFiles).toEqual(
            expect.arrayContaining([
                'src/webviews/index.tsx',
                'src/webviews/cosmosdb/Migration/state/deriveMigrationPhaseStates.ts',
                'packages/nosql-language-service/src/providers/monaco/index.ts',
                'packages/schema-analyzer/src/json/index.ts',
            ]),
        );
    });
});
