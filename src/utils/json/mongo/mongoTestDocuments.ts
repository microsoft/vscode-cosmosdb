/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Binary,
    BSONSymbol,
    Code,
    DBRef,
    Decimal128,
    Double,
    Int32,
    Long,
    MaxKey,
    MinKey,
    ObjectId,
    Timestamp,
    type Document,
    type WithId,
} from 'mongodb';

export const flatDocument: WithId<Document> = {
    _id: new ObjectId(),
    stringField: 'Example String',
    int32Field: new Int32(42),
    longField: Long.fromNumber(9007199254740991),
    doubleField: new Double(3.14),
    decimalField: Decimal128.fromString('123.45'),
    booleanField: true,
    dateField: new Date(),
    nullField: null,
    binaryField: new Binary(Buffer.from('BinaryData'), 0),
    objectIdField: new ObjectId(),
    regexField: /pattern/i,
    codeField: new Code('function() { return true; }'),
    symbolField: new BSONSymbol('exampleSymbol'),
    dbRefField: new DBRef('otherCollection', new ObjectId()),
    timestampField: new Timestamp({ t: 1, i: 2 }),
    maxKeyField: new MaxKey(),
    minKeyField: new MinKey(),
    undefinedField: undefined,
};

export const embeddedDocumentOnly: WithId<Document> = {
    _id: new ObjectId(),
    personalInfo: {
        name: 'John Doe',
        age: 29,
        married: false,
        address: {
            street: '123 Main St',
            city: 'Somewhere',
            zip: '12345',
        },
    },
    jobInfo: {
        company: 'Tech Inc.',
        role: 'Software Engineer',
        salary: 80000,
    },
};

export const arraysWithDifferentDataTypes: WithId<Document> = {
    _id: new ObjectId(),
    integersArray: [1, 2, 3, 4, 5],
    stringsArray: ['one', 'two', 'three'],
    booleansArray: [true, false, true],
    mixedArray: [42, 'text', true, new Date(), null, { key: 'value' }],
    datesArray: [new Date(), new Date('2020-01-01'), new Date('2022-01-01')],
};

export const complexDocument: WithId<Document> = {
    _id: new ObjectId(),
    user: {
        username: 'john_doe',
        email: 'john@example.com',
        profile: {
            firstName: 'John',
            lastName: 'Doe',
            hobbies: ['reading', 'coding', 'hiking'],
            addresses: [
                { street: '123 Main St', city: 'Somewhere', zip: '12345' },
                { street: '456 Second St', city: 'Elsewhere', zip: '54321' },
            ],
        },
    },
    orders: [
        {
            orderId: 1,
            items: [
                { itemName: 'Laptop', quantity: 1, price: Decimal128.fromString('999.99') },
                { itemName: 'Mouse', quantity: 2, price: Decimal128.fromString('19.99') },
            ],
            orderDate: new Date('2023-06-01'),
            shipped: false,
        },
        {
            orderId: 2,
            items: [{ itemName: 'Desk', quantity: 1, price: Decimal128.fromString('199.99') }],
            orderDate: new Date('2023-08-01'),
            shipped: true,
        },
    ],
    history: {
        lastLogin: new Date(),
        lastOrderDate: new Date('2023-08-01'),
        purchaseHistory: [
            { orderId: 1, totalAmount: Decimal128.fromString('1039.96') },
            { orderId: 2, totalAmount: Decimal128.fromString('199.99') },
        ],
    },
};

export const complexDocumentWithOddTypes: WithId<Document> = {
    _id: new ObjectId(),
    user: true, // this is here to catch potential schema traversal issues
    history: {
        lastLoginNew: new Date(),
        lastOrderDateNew: new Date('2023-08-01'),
        purchaseHistoryNew: [
            { orderId: 1, totalAmount: Decimal128.fromString('1039.96') },
            { orderId: 2, totalAmount: Decimal128.fromString('199.99') },
        ],
    },
};

export const complexDocumentsArray: WithId<Document>[] = [
    flatDocument,
    embeddedDocumentOnly,
    arraysWithDifferentDataTypes,
    complexDocument,
];

export const sparseDocumentsArray: WithId<Document>[] = [
    {
        _id: new ObjectId(),
        name: 'Alice',
        age: 25,
        email: 'alice@example.com',
        isActive: true,
        score: 87,
    },
    {
        _id: new ObjectId(),
        name: 'Bob',
        age: 30,
        email: 'bob@example.com',
        isActive: false,
    },
    {
        _id: new ObjectId(),
        name: 'Charlie',
        description: 'Loves hiking and outdoor adventures.',
    },
    {
        _id: new ObjectId(),
        age: 45,
        email: 'eve@example.com',
        isActive: true,
        score: 92,
        description: 'Senior manager at a tech company.',
    },
    {
        _id: new ObjectId(),
        name: 'Frank',
        isActive: false,
        score: 56,
    },
    {
        _id: new ObjectId(),
        email: 'grace@example.com',
        score: 78,
        description: 'Enthusiastic about art and design.',
    },
    {
        _id: new ObjectId(),
        name: 'Heidi',
        age: 32,
        isActive: true,
    },
    {
        _id: new ObjectId(),
        email: 'ivan@example.com',
        score: 66,
        description: 'Enjoys software development and open-source.',
    },
    {
        _id: new ObjectId(),
        name: 'Judy',
        age: 28,
        isActive: false,
        score: 74,
    },
    {
        _id: new ObjectId(),
        name: 'Ken',
        age: 38,
        email: 'ken@example.com',
    },
];
