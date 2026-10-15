/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { FUNCTION_SIGNATURES, getFunctionMeta } from './functionSignatures.js';
import { SqlLanguageService } from './SqlLanguageService.js';

describe('function metadata ownership', () => {
    it('returns independently mutable metadata, signatures and parameters', () => {
        const original = structuredClone(getFunctionMeta('COUNT')!);
        const meta = getFunctionMeta('count')!;
        try {
            meta.category = 'changed';
            meta.signatures[0].parameters[0].label = 'changed';
            meta.signatures[0].label = 'changed';
            meta.signatures.push({ label: 'extra', parameters: [] });
            expect(getFunctionMeta('CoUnT')).toEqual(original);
            expect(FUNCTION_SIGNATURES.COUNT).toEqual(original);
        } finally {
            Object.assign(meta, original);
        }
    });

    it('isolates signature-help results between calls and service instances', () => {
        const query = 'SELECT COUNT(c.value) FROM c';
        const offset = query.indexOf('c.value') + 1;
        const service = new SqlLanguageService();
        const help = service.getSignatureHelp(query, offset)!;
        const original = structuredClone(help);
        try {
            help.signatures[0].parameters[0].documentation = 'changed';
            help.signatures[0].parameters.push({ label: 'extra' });
            help.signatures[0].label = 'changed';
            expect(service.getSignatureHelp(query, offset)).toEqual(original);
            expect(new SqlLanguageService().getSignatureHelp(query, offset)).toEqual(original);
            expect(getFunctionMeta('COUNT')!.signatures).toEqual(original.signatures);
        } finally {
            Object.assign(help.signatures[0], original.signatures[0]);
        }
    });

    it('freezes every level of the public built-in registry', () => {
        expect(Object.isFrozen(FUNCTION_SIGNATURES)).toBe(true);
        for (const meta of Object.values(FUNCTION_SIGNATURES)) {
            expect(Object.isFrozen(meta)).toBe(true);
            expect(Object.isFrozen(meta.signatures)).toBe(true);
            for (const signature of meta.signatures) {
                expect(Object.isFrozen(signature)).toBe(true);
                expect(Object.isFrozen(signature.parameters)).toBe(true);
                for (const parameter of signature.parameters) {
                    expect(Object.isFrozen(parameter)).toBe(true);
                }
            }
        }
    });

    it('rejects JavaScript mutations of nested registry values', () => {
        const parameter = FUNCTION_SIGNATURES.COUNT.signatures[0].parameters[0];
        const label = parameter.label;
        try {
            expect(Reflect.set(parameter, 'label', 'changed')).toBe(false);
            expect(getFunctionMeta('COUNT')!.signatures[0].parameters[0].label).toBe(label);
        } finally {
            Reflect.set(parameter, 'label', label);
        }
    });

    it.each(['unknown_function', '__proto__', 'toString', 'constructor'])('returns no metadata for %s', (name) => {
        expect(getFunctionMeta(name)).toBeUndefined();
    });
});
