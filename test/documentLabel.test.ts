/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getDocumentTreeItemLabel } from '../extension.bundle';

suite('Document Label Tests', () => {
    test('Non-zero number', () => {
        const doc = { name: 4, _id: '12345678901234567890123456789012' };
        assert.equal(getDocumentTreeItemLabel(doc), 4);
    });

    test('zero (number)', () => {
        const doc = { name: 0, _id: '12345678901234567890123456789012' };
        assert.equal(getDocumentTreeItemLabel(doc), 0);
    });

    test('Empty string', () => {
        const doc = { name: '', _id: '' };
        assert.equal(getDocumentTreeItemLabel(doc), '');
    });

    test('Null', () => {
        const doc = { name: null, _id: '12345678901234567890123456789012' };
        assert.equal(getDocumentTreeItemLabel(doc), doc._id);
    });
});
