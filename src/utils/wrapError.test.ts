/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { wrapError } from './wrapError';

// Mock vscode-azext-utils module
jest.mock('@microsoft/vscode-azext-utils', () => ({
    parseError: jest.fn((err: unknown) => {
        if (err instanceof Error) {
            return err;
        }
        return { message: String(err) };
    }),
}));

import { parseError } from '@microsoft/vscode-azext-utils';

describe('wrapError', () => {
    it('just outer string', () => {
        const wrapped = wrapError('Outer error');
        expect(typeof wrapped).toBe('string');
        expect(wrapped).toBe('Outer error');
    });

    it('just outer error', () => {
        const wrapped = wrapError(new Error('Outer error'));
        expect(wrapped).toBeInstanceOf(Error);
        expect(parseError(wrapped).message).toBe('Outer error');
    });

    it('just inner', () => {
        const wrapped = wrapError(undefined, 'Inner error');
        expect(typeof wrapped).toBe('string');
        expect(wrapped).toBe('Inner error');
    });

    it('outer string, inner string', () => {
        const wrapped = wrapError('Outer error.', 'Inner error.');
        expect(wrapped).toBeInstanceOf(Error);
        expect(parseError(wrapped).message).toBe(`Outer error.${os.EOL}Inner error.`);
    });

    it('outer error, inner string', () => {
        const wrapped = wrapError(new Error('Outer error.'), 'Inner error.');
        expect(wrapped).toBeInstanceOf(Error);
        expect(parseError(wrapped).message).toBe(`Outer error.${os.EOL}Inner error.`);
    });

    it('outer error, inner error', () => {
        const wrapped = wrapError(new Error('Outer error.'), new Error('Inner error.'));
        expect(wrapped).toBeInstanceOf(Error);
        expect(parseError(wrapped).message).toBe(`Outer error.${os.EOL}Inner error.`);
    });

    it('outer string, inner error', () => {
        const wrapped = wrapError('Outer error.', new Error('Inner error.'));
        expect(wrapped).toBeInstanceOf(Error);
        expect(parseError(wrapped).message).toBe(`Outer error.${os.EOL}Inner error.`);
    });
});
