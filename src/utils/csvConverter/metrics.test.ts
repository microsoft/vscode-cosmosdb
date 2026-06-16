/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeMetrics, makeResult } from '../convertors/testFixtures';
import { queryMetricsToCsv } from './metrics';

describe('queryMetricsToCsv', () => {
    it('returns an empty string for null', async () => {
        expect(await queryMetricsToCsv(null)).toBe('');
    });

    it('emits a sep header, a titles row and a values row', async () => {
        const result = makeResult({ requestCharge: 5, indexMetrics: 'idx', queryMetrics: makeMetrics() });
        const csv = await queryMetricsToCsv(result);
        const [sepLine, titles, values] = csv.split('\n');

        expect(sepLine).toBe('sep=,');
        // titles include the metrics produced by queryMetricsToTable plus the appended index metrics
        expect(titles).toContain('"Request Charge"');
        expect(titles).toContain('"Index Metrics"');
        // request charge is the first metric; its value column is "5"
        expect(values.startsWith('"5"')).toBe(true);
    });
});
