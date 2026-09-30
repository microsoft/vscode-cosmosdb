/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Binary } from 'bson';
import { describe, expect, it } from 'vitest';
import { getKnownFields, simplifySchema, type JSONSchema } from '../index.js';
import { SchemaAnalyzer } from './index.js';

describe('BSON analyzer result ownership', () => {
    it('returns independently mutable schema snapshots, including nested objects and items', () => {
        const analyzer = SchemaAnalyzer.fromDocument({ nested: { value: 1 }, values: [1] });
        const original = structuredClone(analyzer.getSchema());
        const snapshot = analyzer.getSchema();
        simplifySchema(snapshot);
        (snapshot.properties!['nested'] as JSONSchema).properties!['value'] = false;
        (snapshot.properties!['values'] as JSONSchema).items = false;
        snapshot['x-documentsInspected'] = 100;
        expect(analyzer.getSchema()).toEqual(original);
        expect(analyzer.getDocumentCount()).toBe(1);
        expect(analyzer.version).toBe(1);
        expect(analyzer.getSchema()).not.toBe(analyzer.getSchema());
    });

    it('does not change old snapshots when documents are added or the analyzer is reset', () => {
        const analyzer = SchemaAnalyzer.fromDocument({ value: 1 });
        const snapshot = analyzer.getSchema();
        const original = structuredClone(snapshot);
        analyzer.addDocument({ value: 'text', extra: true });
        expect(snapshot).toEqual(original);
        analyzer.reset();
        expect(snapshot).toEqual(original);
        expect(analyzer.getSchema()).toEqual({});
    });

    it('protects cached field arrays, field objects and nested dataTypes', () => {
        const analyzer = SchemaAnalyzer.fromDocuments([{ value: 1 }, { value: 'text' }]);
        const fields = analyzer.getKnownFields();
        const original = structuredClone(fields);
        fields[0].dataTypes!.push('injected');
        fields[0].path = 'renamed';
        fields.length = 0;
        expect(analyzer.getKnownFields()).toEqual(original);
        expect(analyzer.getKnownFields()).not.toBe(analyzer.getKnownFields());
        expect(analyzer.version).toBe(1);
    });

    it.each(['single', 'batch'] as const)('invalidates version and cached fields after a failed %s update', (mode) => {
        const analyzer = SchemaAnalyzer.fromDocument({ original: true });
        const before = analyzer.getKnownFields();
        const invalid = new Binary(Buffer.alloc(1));
        Object.defineProperty(invalid, 'length', { value: () => -1 });
        const document = { added: 1, invalid };
        const update = () =>
            mode === 'single'
                ? analyzer.addDocument(document)
                : analyzer.addDocuments([{ preceding: true }, document, { unreached: true }]);

        expect(update).toThrow(TypeError);
        expect(analyzer.version).toBe(2);
        const schema = analyzer.getSchema();
        const fields = analyzer.getKnownFields();
        expect(fields).not.toEqual(before);
        expect(fields).toEqual(getKnownFields(schema, 'x-bsonType'));
        expect(fields.map((field) => field.path)).toContain('added');
        expect(schema.properties).not.toHaveProperty('unreached');
        expect(analyzer.getDocumentCount()).toBe(mode === 'single' ? 2 : 3);

        analyzer.addDocument({ recovered: true });
        expect(analyzer.version).toBe(3);
        expect(analyzer.getKnownFields().map((field) => field.path)).toContain('recovered');
    });

    it('propagates getter failures and records the invalidation even before fields are processed', () => {
        const analyzer = SchemaAnalyzer.fromDocument({ original: true });
        analyzer.getKnownFields();
        const failure = new Error('Unreadable document');
        const document = Object.defineProperty({}, 'value', {
            enumerable: true,
            get: () => {
                throw failure;
            },
        });
        expect(() => analyzer.addDocument(document)).toThrow(failure);
        expect(analyzer.version).toBe(2);
        expect(analyzer.getDocumentCount()).toBe(2);
        expect(analyzer.getKnownFields()).toEqual(getKnownFields(analyzer.getSchema(), 'x-bsonType'));
    });
});
