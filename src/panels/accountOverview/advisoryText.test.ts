/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { escapeAdvisoryText, parseAdvisoryText } from './advisoryText';
import { OverProvisioningDetector } from './services/advisories/detectors/OverProvisioningDetector';

describe('advisory text', () => {
    it('preserves plain text and highlights complete marked phrases only', () => {
        expect(parseAdvisoryText('P99 on orders-2026: `5%`, target `~400 RU/s`.')).toEqual([
            { text: 'P99 on orders-2026: ', highlighted: false },
            { text: '5%', highlighted: true },
            { text: ', target ', highlighted: false },
            { text: '~400 RU/s', highlighted: true },
            { text: '.', highlighted: false },
        ]);
        expect(parseAdvisoryText('HTTP 429; 99th percentile; orders-2026.')).toEqual([
            { text: 'HTTP 429; 99th percentile; orders-2026.', highlighted: false },
        ]);
        expect(parseAdvisoryText('')).toEqual([]);
    });

    it('does not depend on English word order, numeric syntax or unit spelling', () => {
        expect(
            parseAdvisoryText('Pendant `30 jours`, cible `1\u202f234,5 RU/s`, charge `\u0665\u066a`.')
                .filter((part) => part.highlighted)
                .map((part) => part.text),
        ).toEqual(['30 jours', '1\u202f234,5 RU/s', '\u0665\u066a']);
    });

    it.each(['unfinished `400 RU/s', 'empty `` pair', 'a trailing `', 'literal C:\\data'])(
        'preserves malformed or plain input: %s',
        (text) => {
            const parts = parseAdvisoryText(text);
            expect(parts.map((part) => part.text).join('')).toBe(text);
            expect(parts.every((part) => !part.highlighted)).toBe(true);
        },
    );

    it('round-trips literal names and queries without treating their backticks as markup', () => {
        const literal = 'orders-`2026`\\archive SELECT "<img src=x>"';
        const parts = parseAdvisoryText(`${escapeAdvisoryText(literal)}: \`400 RU/s\``);
        expect(parts.map((part) => part.text).join('')).toBe(`${literal}: 400 RU/s`);
        expect(parts.filter((part) => part.highlighted)).toEqual([{ text: '400 RU/s', highlighted: true }]);
    });

    it('marks detector evidence without changing the deferred minimum-capacity verdict', () => {
        const container = 'order-`2026`';
        const finding = new OverProvisioningDetector().evaluate(
            5,
            5,
            30,
            true,
            400,
            1400,
            'db/order',
            container,
            '30 days',
        );
        expect(finding?.severity).toBe('Low');
        expect(finding?.rationale.length).toBeLessThanOrEqual(500);
        const rationale = parseAdvisoryText(finding?.rationale ?? '');
        expect(rationale.filter((part) => part.highlighted).map((part) => part.text)).toEqual([
            '5%',
            '30 days',
            '30%',
            '90%',
            '0 RU/s',
            '~400 RU/s',
        ]);
        expect(rationale.map((part) => part.text).join('')).toContain(`Container "${container}" stayed at 5%`);
        expect(finding?.suggestedAction).toContain('from `400 RU/s` toward `~400 RU/s`');
        expect(finding?.thresholdReference).toBe('Threshold: p99 RU < `30%` and peak < `90%`');
    });
});
