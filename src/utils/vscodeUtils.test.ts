/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { getItemTreeItemLabel } from './vscodeUtils';

describe('Item Label Tests', () => {
    beforeAll(() => {
        jest.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: jest.fn().mockReturnValue(['name']),
            has: jest.fn(),
            inspect: jest.fn(),
            update: jest.fn(),
        });
    });

    it('Non-zero number', () => {
        const doc = { name: 4, _id: '12345678901234567890123456789012' };
        expect(getItemTreeItemLabel(doc)).toEqual('4');
    });

    it('zero (number)', () => {
        const doc = { name: 0, _id: '12345678901234567890123456789012' };
        expect(getItemTreeItemLabel(doc)).toEqual('0');
    });

    it('Empty string', () => {
        const doc = { name: '', _id: '' };
        expect(getItemTreeItemLabel(doc)).toEqual('');
    });

    it('Null', () => {
        const doc = { name: null, _id: '12345678901234567890123456789012' };
        expect(getItemTreeItemLabel(doc)).toEqual(doc._id);
    });
});
