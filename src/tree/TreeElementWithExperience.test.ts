/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { isTreeElementWithExperience } from './TreeElementWithExperience';

describe('isTreeElementWithExperience', () => {
    it('accepts an object with an experience property', () => {
        expect(isTreeElementWithExperience({ experience: { api: 'Core' } })).toBe(true);
        // The guard only checks for the property's presence, not its shape.
        expect(isTreeElementWithExperience({ experience: undefined })).toBe(true);
    });

    it('rejects objects without experience and non-objects', () => {
        expect(isTreeElementWithExperience({})).toBe(false);
        expect(isTreeElementWithExperience(null)).toBe(false);
        expect(isTreeElementWithExperience(undefined)).toBe(false);
        expect(isTreeElementWithExperience('experience')).toBe(false);
        expect(isTreeElementWithExperience(123)).toBe(false);
    });
});
