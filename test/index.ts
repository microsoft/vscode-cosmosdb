/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { glob } from 'glob';
import Mocha from 'mocha';
import * as path from 'path';

export async function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'tdd',
    });

    const testsRoot = path.resolve(__dirname, '..');

    try {
        const files = await glob('test/**/**.test.js', { cwd: testsRoot });

        // Add files to the test suite
        files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

        // Run the mocha test
        await new Promise<void>((resolve, reject) => {
            try {
                mocha.run((failures) => {
                    if (failures > 0) {
                        reject(new Error(`${failures} tests failed.`));
                    } else {
                        resolve();
                    }
                });
            } catch (err) {
                console.error(err);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    } catch (err) {
        throw err instanceof Error ? err : new Error(String(err));
    }
}
