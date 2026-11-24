/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { glob } from 'glob';
import { describe, run as runTests } from 'node:test';
import { pathToFileURL } from 'node:url';

export async function run(): Promise<void> {
    const here = import.meta.dirname;
    const files = await glob('**/*.test.js', { cwd: here, absolute: true });
    if (files.length === 0) {
        throw new Error(`No integration test files found under ${here}.`);
    }

    const suiteName = 'Extension Host integration tests';
    const result = Promise.withResolvers<void>();
    runTests({
        files: [],
        isolation: 'none',
        setup() {
            void describe(suiteName, async () => {
                for (const file of files.sort()) {
                    await import(pathToFileURL(file).href);
                }
            });
        },
    })
        .once('error', result.reject)
        .once('end', () => result.reject(new Error(`${suiteName} ended without a result.`)))
        // The stream ends at beforeExit, but VS Code waits for run() before exiting.
        // The enclosing suite's result arrives after its children, while the host is still running.
        .on('data', ({ type, data }) => {
            if (type !== 'test:pass' && type !== 'test:fail') return;
            const indent = '  '.repeat(data.nesting);
            if (type === 'test:fail') {
                console.error(`${indent}FAIL ${data.name}`, data.details.error);
            } else {
                console.log(`${indent}${data.skip || data.todo ? 'SKIP' : 'PASS'} ${data.name}`);
            }
            if (data.nesting === 0 && data.name === suiteName) {
                if (type === 'test:fail') result.reject(new Error(`${suiteName} failed.`));
                else result.resolve();
            }
        });
    await result.promise;
}
