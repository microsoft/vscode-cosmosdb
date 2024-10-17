/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import * as os from 'os';
import { wrapError } from '../extension.bundle';

suite('wrapError', () => {
    test('just outer string', () => {
        const wrapped = wrapError('Outer error');
        assert(typeof wrapped === 'string');
        assert.equal(wrapped, 'Outer error');
    });

    test('just outer error', () => {
        const wrapped = wrapError(new Error('Outer error'));
        assert(wrapped instanceof Error);
        assert.equal(parseError(wrapped).message, 'Outer error');
    });

    test('just inner', () => {
        const wrapped = wrapError(undefined, 'Inner error');
        assert(typeof wrapped === 'string');
        assert.equal(wrapped, 'Inner error');
    });

    test('outer string, inner string', () => {
        const wrapped = wrapError('Outer error.', 'Inner error.');
        assert(wrapped instanceof Error);
        assert.equal(parseError(wrapped).message, `Outer error.${os.EOL}Inner error.`);
    });

    test('outer error, inner string', () => {
        const wrapped = wrapError(new Error('Outer error.'), 'Inner error.');
        assert(wrapped instanceof Error);
        assert.equal(parseError(wrapped).message, `Outer error.${os.EOL}Inner error.`);
    });

    test('outer error, inner error', () => {
        const wrapped = wrapError(new Error('Outer error.'), new Error('Inner error.'));
        assert(wrapped instanceof Error);
        assert.equal(parseError(wrapped).message, `Outer error.${os.EOL}Inner error.`);
    });

    test('outer string, inner error', () => {
        const wrapped = wrapError('Outer error.', new Error('Inner error.'));
        assert(wrapped instanceof Error);
        assert(parseError(wrapped).message, `Outer error.${os.EOL}Inner error.`);
    });
});
