/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sanitizeId } from './DocDBUtils';

describe('DocDBUtils', function () {
    it('Replaces + with whitespace', function () {
        const id = 'a+b+c';
        const sanitizedId = sanitizeId(id);
        expect(sanitizedId).toStrictEqual('a b c');
    });
});
