/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, vi } from 'vitest';
import { SettingsService } from '../../services/SettingsService';
import { makeResult } from '../convertors/testFixtures';
import { queryResultToCsv } from './table';

describe('queryResultToCsv', () => {
    beforeEach(() => {
        // getCsvSeparator() reads this setting; pin it to ',' for deterministic output.
        vi.spyOn(SettingsService, 'getSetting').mockReturnValue(',');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns an empty string for null', async () => {
        expect(await queryResultToCsv(null)).toBe('');
    });

    it('builds a sep header, header row and value rows using the configured separator', async () => {
        const result = makeResult({ query: 'SELECT c.id, c.name FROM c', documents: [{ id: '1', name: 'x' }] });
        const [sepLine, headers, firstRow] = (await queryResultToCsv(result)).split('\n');

        expect(sepLine).toBe('sep=,');
        expect(headers).toBe('"id","name"');
        expect(firstRow).toBe('"1","x"');
    });

    it('applies the row selection filter', async () => {
        const result = makeResult({ query: 'SELECT c.id FROM c', documents: [{ id: '1' }, { id: '2' }, { id: '3' }] });
        const lines = (await queryResultToCsv(result, undefined, [1])).split('\n');
        // sep + header + a single selected data row
        expect(lines.slice(2)).toEqual(['"2"']);
    });

    it('JSON-stringifies non-string values before escaping', async () => {
        const result = makeResult({ query: 'SELECT c.id, c.meta FROM c', documents: [{ id: '1', meta: { a: 1 } }] });
        const lines = (await queryResultToCsv(result)).split('\n');
        // {a:1} → JSON.stringify → {"a":1} → escaped (inner quotes doubled)
        expect(lines[2]).toBe('"1","{""a"":1}"');
    });
});
