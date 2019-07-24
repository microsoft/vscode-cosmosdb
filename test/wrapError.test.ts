/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import { wrapError } from '../extension.bundle';
import { parseError } from 'vscode-azureextensionui';

suite("wrapError", () => {
    test("just outer string", () => {
        let wrapped = wrapError('Outer error')
        assert(typeof wrapped === 'string');
        assert.equal(wrapped, 'Outer error');
    });

    test("just outer error", () => {
        let wrapped = wrapError(new Error('Outer error'));
        assert(wrapped instanceof Error);
        assert.equal(parseError(wrapped).message, 'Outer error');
    });

    test("just inner", () => {
        let wrapped = wrapError(undefined, 'Inner error')
        assert(typeof wrapped === 'string');
        assert.equal(wrapped, 'Inner error');
    });

    test("outer string, inner string", () => {
        let wrapped = wrapError('Outer error.', 'Inner error.')
        assert(wrapped instanceof Error);
        assert(parseError(wrapped).message, `Outer error.${os.EOL}Inner error.`);
    });

    test("outer error, inner string", () => {
        let wrapped = wrapError(new Error('Outer error.'), 'Inner error.')
        assert(wrapped instanceof Error);
        assert(parseError(wrapped).message, `Outer error.${os.EOL}Inner error.`);
    });

    test("outer error, inner error", () => {
        let wrapped = wrapError(new Error('Outer error.'), new Error('Inner error.'));
        assert(wrapped instanceof Error);
        assert(parseError(wrapped).message, `Outer error.${os.EOL}Inner error.`);
    });

    test("outer string, inner error", () => {
        let wrapped = wrapError('Outer error.', new Error('Inner error.'));
        assert(wrapped instanceof Error);
        assert(parseError(wrapped).message, `Outer error.${os.EOL}Inner error.`);
    });
});
