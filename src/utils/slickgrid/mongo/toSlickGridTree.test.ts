/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectId, type Document, type WithId } from 'mongodb';
import { documentToSlickGridTree, toSlickGridTree } from './toSlickGridTree';

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

describe('toSlickGridTree', () => {
    it('1 doc -> tree data', () => {
        const tree = documentToSlickGridTree(mongoDocuments[0]);

        // 1 root node for 1 document
        expect(tree.filter((node) => node.parentId === null)).toHaveLength(1);
        expect(tree).toHaveLength(11);
    });

    it('n docs -> tree data', () => {
        const tree = toSlickGridTree(mongoDocuments);

        // 4 root nodes for 4 documents
        expect(tree.filter((node) => node.parentId === null)).toHaveLength(4);
        expect(tree).toHaveLength(39);
    });
});
