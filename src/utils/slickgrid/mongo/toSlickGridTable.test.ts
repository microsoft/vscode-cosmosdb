/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectId, type Document, type WithId } from 'mongodb';
import { getDataAtPath } from './toSlickGridTable';

const jsonDocuments = [
    {
        name: 'Document 1',
        nestedDocument: {
            key: 'value',
            anotherKey: 'anotherValue',
        },
        array: [
            'value1',
            'value2',
            {
                key: 'value',
            },
        ],
    },
    {
        name: 'Document 1',
        nestedDocument: {
            key: 'value',
            subNestedDocument: {
                a_key: false,
            },
        },
        array: [
            'value1',
            'value2',
            {
                key: 'value',
            },
        ],
    },
    {
        title: 'The Favourite',
        genres: ['Drama', 'History'],
        runtime: 121,
        rated: 'R',
        year: 2018,
        directors: ['Yorgos Lanthimos'],
        cast: ['Olivia Colman', 'Emma Stone', 'Rachel Weisz'],
        type: 'movie',
    },
    {
        songName: 'There goes my baby',
        firstName: 'Murray',
        genre: 'Hip Hop',
        recent: '2024-08-20T21:29:34.957Z',
    },
    {
        songName: 'With Or Without You',
        firstName: 'Anastacio',
        genre: 'Non Music',
        recent: '2024-08-21T02:49:29.160Z',
    },
];

const mongoDocuments: WithId<Document>[] = jsonDocuments.map((doc) => {
    return {
        _id: new ObjectId(),
        ...doc,
    };
});

describe('toSlickGridTable', () => {
    it('at the root', () => {
        const tableData = getDataAtPath(mongoDocuments, []);
        expect(tableData).toHaveLength(5);
    });

    it('at a nested level', () => {
        const tableData = getDataAtPath(mongoDocuments, ['nestedDocument']);
        console.log(tableData);

        expect(tableData).toHaveLength(5);
        expect(tableData[0]['key']).toBeDefined();
        expect(tableData[1]['key']).toEqual({ value: 'value', type: 'string' });
        expect(tableData[0]['anotherKey']).toBeDefined();
        expect(tableData[1]['subNestedDocument']).toBeDefined();
    });

    it('at a 2nd nested level', () => {
        const tableData = getDataAtPath(mongoDocuments, ['nestedDocument', 'subNestedDocument']);
        expect(tableData).toHaveLength(5);
        expect(tableData[1]['a_key']).toBeDefined();
        expect(tableData[1]['a_key']).toEqual({ value: 'false', type: 'boolean' });
    });
});
