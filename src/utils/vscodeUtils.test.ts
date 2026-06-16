/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { dispose, getDocumentTreeItemLabel, getNodeEditorLabel, toDisposable } from './vscodeUtils';

describe('disposable helpers', () => {
    it('dispose() calls dispose on every item and returns an empty array', () => {
        const a = { dispose: vi.fn() };
        const b = { dispose: vi.fn() };
        const result = dispose([a, b]);
        expect(a.dispose).toHaveBeenCalledOnce();
        expect(b.dispose).toHaveBeenCalledOnce();
        expect(result).toEqual([]);
    });

    it('toDisposable() wraps a callback into an IDisposable', () => {
        const cb = vi.fn();
        const disposable = toDisposable(cb);
        disposable.dispose();
        expect(cb).toHaveBeenCalledOnce();
    });
});

describe('getNodeEditorLabel', () => {
    it('returns the node id', () => {
        expect(getNodeEditorLabel({ id: 'account/db/collection' } as never)).toBe('account/db/collection');
    });
});

describe('Document Label Tests', () => {
    beforeAll(() => {
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: vi.fn().mockReturnValue(['name']),
            has: vi.fn(),
            inspect: vi.fn(),
            update: vi.fn(),
        });
    });

    it('Non-zero number', () => {
        const doc = { name: 4, _id: '12345678901234567890123456789012' };
        expect(getDocumentTreeItemLabel(doc)).toEqual('4');
    });

    it('zero (number)', () => {
        const doc = { name: 0, _id: '12345678901234567890123456789012' };
        expect(getDocumentTreeItemLabel(doc)).toEqual('0');
    });

    it('Empty string', () => {
        const doc = { name: '', _id: '' };
        expect(getDocumentTreeItemLabel(doc)).toEqual('');
    });

    it('Null', () => {
        const doc = { name: null, _id: '12345678901234567890123456789012' };
        expect(getDocumentTreeItemLabel(doc)).toEqual(doc._id);
    });

    it('skips object-valued label fields and falls back to _id', () => {
        const doc = { name: { nested: true }, _id: 'fallback-id' };
        expect(getDocumentTreeItemLabel(doc)).toEqual('fallback-id');
    });

    it('falls back to id when _id is missing', () => {
        const doc = { name: undefined, id: 'doc-id' };
        expect(getDocumentTreeItemLabel(doc)).toEqual('doc-id');
    });
});
