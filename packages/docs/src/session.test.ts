/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import scenarios from '../samples/scenarios.json';
import { inferSchema } from '../samples/schema';
import { createSession } from './session';

describe('JSON schema sample', () => {
    it.each(['', '   ', '[]', '{}', 'null', '[null]', '[1]', '[[]]'])(
        'rejects unusable documents: %s',
        (input) => {
            expect(() => inferSchema(input)).toThrow(/document|JSON/i);
        },
    );

    it('rejects malformed JSON rather than evaluating JavaScript', () => {
        expect(() => inferSchema('[{id: "not-json"}]')).toThrow();
    });

    it.each([
        '__proto__',
        'constructor',
        'prototype',
        'toString',
        'hasOwnProperty',
    ])('rejects prototype-colliding keys before inference: %s', (key) => {
        const before = Object.getOwnPropertyDescriptors(Object.prototype);
        expect(() =>
            inferSchema(`[{"items":[{"nested":{"${key}":{"value":1}}}]}]`),
        ).toThrow(/not supported by schema analyzer/);
        expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
            before,
        );
        expect(inferSchema('[{"safe":1}]').properties).toHaveProperty('safe');
    });

    it.each(scenarios)(
        'infers a schema for the $name scenario',
        ({ documents }) => {
            expect(
                inferSchema(JSON.stringify(documents)).properties,
            ).toHaveProperty('id');
        },
    );

    it('preserves nested and heterogeneous field information', () => {
        const schema = inferSchema(
            '[{"value":1,"nested":{"city":"Prague"}},{"value":"unknown"}]',
        );
        expect(JSON.stringify(schema.properties?.value)).toContain('number');
        expect(JSON.stringify(schema.properties?.value)).toContain('string');
        expect(JSON.stringify(schema.properties?.nested)).toContain('city');
    });
});

describe('playground service session', () => {
    it('refreshes field completions through the same service when documents change', () => {
        const session = createSession();
        const completions = () =>
            session.service
                .getCompletions('SELECT c. FROM c', 9)
                .map((item) => item.label);
        session.applyDocuments('[{"firstField":1}]');
        expect(completions()).toContain('firstField');

        session.applyDocuments('[{"secondField":true}]');
        expect(completions()).toContain('secondField');
        expect(completions()).not.toContain('firstField');
    });

    it('removes a previously applied schema on failure and recovers on the next valid apply', () => {
        const session = createSession();
        session.applyDocuments('[{"oldField":1}]');
        expect(() => session.applyDocuments('[]')).toThrow();
        expect(session.schema).toBeUndefined();
        expect(
            session.service
                .getCompletions('SELECT c. FROM c', 9)
                .map((item) => item.label),
        ).not.toContain('oldField');
        expect(
            session.service.getDiagnostics('SELECT * FORM c').length,
        ).toBeGreaterThan(0);

        session.applyDocuments('[{"newField":2}]');
        expect(session.schema?.properties).toHaveProperty('newField');
    });

    it('reports invalid SQL and document-relative positions for multiple queries', () => {
        const { service } = createSession();
        expect(service.getDiagnostics('SELECT * FROM c')).toEqual([]);
        const diagnostics = service.getDiagnostics(
            'SELECT * FROM c;\n\nSELECT * FORM c',
        );
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(
            diagnostics.every((diagnostic) => diagnostic.range.startLine >= 3),
        ).toBe(true);
    });

    it('formats valid SQL without repairing invalid SQL', () => {
        const { service } = createSession();
        expect(service.format('select * from c')).toContain('SELECT');
        const invalid = 'SELECT * FORM c';
        expect(service.format(invalid)).toBe(invalid);
    });
});
