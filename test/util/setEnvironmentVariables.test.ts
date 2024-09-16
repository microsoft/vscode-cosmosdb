/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isWindows } from '../../extension.bundle';
import { setEnvironmentVariables } from './setEnvironmentVariables';

suite('setEnvironmentVariables (test util)', () => {
    test('restore', () => {
        const currentPath = process.env.PATH;
        const dispose = setEnvironmentVariables({ PATH: 'new path' });

        assert.equal(process.env.PATH, 'new path');

        dispose.dispose();

        assert.equal(process.env.PATH, currentPath);
    });

    test('different casings (Windows)', () => {
        if (isWindows) {
            const currentPath = process.env.paTH;
            const dispose = setEnvironmentVariables({ PAth: 'new path' });

            assert.equal(process.env.path, 'new path');
            assert.equal(process.env.PATH, 'new path');

            dispose.dispose();

            assert.equal(process.env.path, currentPath);
            assert.equal(process.env.PATH, currentPath);
        }
    });
});
