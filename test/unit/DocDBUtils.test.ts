/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { describe, it } from 'mocha';
import { sanitizeId } from '../../src/docdb/tree/DocDBUtils';

describe('DocDBUtils', function () {
    it('Replaces + with whitespace', function () {
        const id = 'a+b+c';
        const sanitizedId = sanitizeId(id);
        assert.strictEqual(sanitizedId, 'a b c');
    });
});
