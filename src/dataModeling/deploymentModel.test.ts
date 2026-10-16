/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getDeploymentTemplateFileName } from './deploymentModel';

describe('deployment template filenames', () => {
    it.each([
        ['orders', 'cosmos-orders'],
        ['Sales_2026-v2', 'cosmos-Sales_2026-v2'],
        ['customer orders', 'cosmos-customer orders'],
        [' orders. . ', 'cosmos-orders'],
        ['orders<>:"/\\|?*archive', 'cosmos-orders---------archive'],
        ['orders\u0000\u001f\u007f\u0085archive', 'cosmos-orders----archive'],
        ['../..\\orders', 'cosmos-..-..-orders'],
        ['CON', 'cosmos-CON'],
        ['NUL.txt', 'cosmos-NUL.txt'],
        ['COM1', 'cosmos-COM1'],
        ['LPT9', 'cosmos-LPT9'],
        ['\u8ba2\u5355-caf\u00e9', 'cosmos-\u8ba2\u5355-caf\u00e9'],
        ['', 'cosmos-database'],
        ['   ', 'cosmos-database'],
        ['.. .', 'cosmos-database'],
        ['a'.repeat(100), `cosmos-${'a'.repeat(60)}`],
        [`${'a'.repeat(59)}.tail`, `cosmos-${'a'.repeat(59)}`],
    ])('suggests safe filenames for %j', (databaseName, stem) => {
        expect(getDeploymentTemplateFileName('bicep', databaseName)).toBe(`${stem}.bicep`);
        expect(getDeploymentTemplateFileName('terraform', databaseName)).toBe(`${stem}.tf`);
        expect(getDeploymentTemplateFileName('sdk', databaseName)).toBe('Program.cs');
    });

    it.each(['bicep', 'terraform'] as const)('caps %s names without splitting Unicode characters', (format) => {
        const character = '\u{1f680}';
        const fileName = getDeploymentTemplateFileName(format, character.repeat(100));
        expect(fileName).toBe(`cosmos-${character.repeat(60)}.${format === 'bicep' ? 'bicep' : 'tf'}`);
        expect(Buffer.byteLength(fileName, 'utf-8')).toBeLessThanOrEqual(255);
        expect(fileName.length).toBeLessThanOrEqual(255);
        expect(fileName).not.toContain('\ufffd');
    });
});
