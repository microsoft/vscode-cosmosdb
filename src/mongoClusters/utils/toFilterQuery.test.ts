/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toFilterQueryObj } from './toFilterQuery';

const q1 = '{ }';
const q2 = '{ "name": "John" }';
const q3 = '{ "name": "John", "age": 30 }';
const q4 = '{ "name": "John", "age": { "$gt": 30 } }';
const q5 = '{ "name": "John", "age": { "$gt": 30, "$lt": 40 } }';

describe('toFilterQuery', () => {
    it('converts query strings to basic queries', () => {
        expect(toFilterQueryObj(q1)).toEqual({});
        expect(toFilterQueryObj(q2)).toEqual({ name: 'John' });
        expect(toFilterQueryObj(q3)).toEqual({ name: 'John', age: 30 });
        expect(toFilterQueryObj(q4)).toEqual({ name: 'John', age: { $gt: 30 } });
        expect(toFilterQueryObj(q5)).toEqual({ name: 'John', age: { $gt: 30, $lt: 40 } });
    });
});
