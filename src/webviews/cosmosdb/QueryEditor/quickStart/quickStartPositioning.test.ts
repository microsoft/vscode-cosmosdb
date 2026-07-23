/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { toFluentPositioning } from './quickStartPositioning';

describe('toFluentPositioning', () => {
    it('defaults to below/center when unspecified', () => {
        expect(toFluentPositioning(undefined)).toEqual({ position: 'below', align: 'center' });
    });

    it('maps below variants', () => {
        expect(toFluentPositioning('below')).toEqual({ position: 'below', align: 'center' });
        expect(toFluentPositioning('below-start')).toEqual({ position: 'below', align: 'start' });
        expect(toFluentPositioning('below-end')).toEqual({ position: 'below', align: 'end' });
    });

    it('maps above variants', () => {
        expect(toFluentPositioning('above')).toEqual({ position: 'above', align: 'center' });
        expect(toFluentPositioning('above-start')).toEqual({ position: 'above', align: 'start' });
        expect(toFluentPositioning('above-end')).toEqual({ position: 'above', align: 'end' });
    });

    it('maps before/after to center alignment', () => {
        expect(toFluentPositioning('before')).toEqual({ position: 'before', align: 'center' });
        expect(toFluentPositioning('after')).toEqual({ position: 'after', align: 'center' });
    });
});
