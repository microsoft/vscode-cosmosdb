/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { validateContainerName, validateDatabaseName } from './validateResourceName';

describe.each([
    ['database', validateDatabaseName],
    ['container', validateContainerName],
] as const)('%s name validation', (_, validate) => {
    it.each(['', ' ', '\t'])('requires a nonempty name: %j', (name) => {
        expect(validate(name)).toMatch(/name is required/);
    });

    it.each(['/', '\\', '?', '#'])('rejects the documented forbidden character %j', (character) => {
        expect(validate(`name${character}value`)).toMatch(/cannot contain/);
    });

    it('enforces the documented 255-character boundary', () => {
        expect(validate('a')).toBeUndefined();
        expect(validate('a'.repeat(255))).toBeUndefined();
        expect(validate('a'.repeat(256))).toMatch(/cannot be longer than 255/);
    });

    it.each(['name ', 'name\t', 'my name  '])('rejects trailing whitespace like Data Explorer: %j', (name) => {
        expect(validate(name)).toMatch(/cannot end with whitespace/);
    });

    it.each(['my-name_1', 'Order details', ' leading', '\u8ba2\u5355'])('accepts supported names: %j', (name) => {
        expect(validate(name)).toBeUndefined();
    });
});
