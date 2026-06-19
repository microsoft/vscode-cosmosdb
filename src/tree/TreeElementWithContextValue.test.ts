/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { isTreeElementWithContextValue, TreeElementWithContextValue } from './TreeElementWithContextValue';

describe('isTreeElementWithContextValue', () => {
    it('accepts an object with a contextValue property', () => {
        expect(isTreeElementWithContextValue({ contextValue: 'treeItem.container' })).toBe(true);
    });

    it('rejects objects without contextValue and non-objects', () => {
        expect(isTreeElementWithContextValue({})).toBe(false);
        expect(isTreeElementWithContextValue(null)).toBe(false);
        expect(isTreeElementWithContextValue(undefined)).toBe(false);
        expect(isTreeElementWithContextValue('contextValue')).toBe(false);
    });
});

describe('TreeElementWithContextValue.createContextValue', () => {
    it('de-duplicates, sorts, and joins with ";"', () => {
        expect(TreeElementWithContextValue.createContextValue(['b', 'a', 'b', 'c'])).toBe('a;b;c');
    });

    it('returns an empty string for an empty list', () => {
        expect(TreeElementWithContextValue.createContextValue([])).toBe('');
    });

    it('is deterministic regardless of input order', () => {
        const a = TreeElementWithContextValue.createContextValue(['experience.nosql', 'treeItem.container']);
        const b = TreeElementWithContextValue.createContextValue(['treeItem.container', 'experience.nosql']);
        expect(a).toBe(b);
    });

    it('handles a single value', () => {
        expect(TreeElementWithContextValue.createContextValue(['only'])).toBe('only');
    });
});
