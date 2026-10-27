/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import manifest from '../package.json';
import labels from '../package.nls.json';
import { OVERVIEW_DEFAULTS } from './panels/accountOverview/services/healthPolicy';

const overviewPrefix = 'cosmosDB.accountOverview.';
const overviewTitleKey = 'cosmosdb.configuration.accountOverview.title';
const overviewTitle = `%${overviewTitleKey}%`;
const categories = manifest.contributes.configuration;
const registrations = categories.flatMap((category) => Object.entries(category.properties));
const overviewKeys = registrations.map(([key]) => key).filter((key) => key.startsWith(overviewPrefix));

describe('Account Overview settings category', () => {
    it('exposes exactly the six Health/view controls with matching runtime defaults', () => {
        const defaults = {
            'cosmosDB.accountOverview.health.criticalRuPercent': OVERVIEW_DEFAULTS.health.criticalRuPercent,
            'cosmosDB.accountOverview.health.warningRuPercent': OVERVIEW_DEFAULTS.health.warningRuPercent,
            'cosmosDB.accountOverview.partition.topN': OVERVIEW_DEFAULTS.partition.topN,
            'cosmosDB.accountOverview.health.partitionSaturationPercent': OVERVIEW_DEFAULTS.partition.saturationPercent,
            'cosmosDB.accountOverview.health.partitionHeadroomPercent': OVERVIEW_DEFAULTS.partition.headroomPercent,
            'cosmosDB.accountOverview.health.storageSkewBalanceRatio': OVERVIEW_DEFAULTS.partition.skewBalanceRatio,
        };
        expect([...overviewKeys].sort()).toEqual(Object.keys(defaults).sort());
        for (const [key, value] of Object.entries(defaults)) {
            expect(registrations.find(([registered]) => registered === key)?.[1]).toHaveProperty('default', value);
        }
    });

    it('registers every setting exactly once', () => {
        const keys = registrations.map(([key]) => key);
        expect(keys).toHaveLength(new Set(keys).size);
    });

    it('groups all and only Overview settings in one separate, localized category', () => {
        const overviewCategories = categories.filter((category) => category.title === overviewTitle);
        expect(overviewCategories).toHaveLength(1);
        expect(labels[overviewTitleKey]).toBe('Account Overview');
        expect(overviewKeys.length).toBeGreaterThan(0);
        expect(Object.keys(overviewCategories[0].properties).sort()).toEqual([...overviewKeys].sort());
        expect(overviewCategories[0]).not.toHaveProperty('scope');
        expect(categories.map(({ title }) => title)).toEqual(
            expect.arrayContaining(['Azure Cosmos DB', 'Authentication']),
        );

        for (const category of categories.filter((category) => category.title !== overviewTitle)) {
            expect(Object.keys(category.properties).some((key) => key.startsWith(overviewPrefix))).toBe(false);
        }
    });

    it.each([
        { key: 'health.criticalRuPercent', minimum: 0, maximum: 100 },
        { key: 'health.warningRuPercent', minimum: 0, maximum: 100 },
        { key: 'health.partitionSaturationPercent', minimum: 0, maximum: 100 },
        { key: 'health.partitionHeadroomPercent', minimum: 0, maximum: 100 },
        { key: 'health.storageSkewBalanceRatio', minimum: 0, maximum: 1 },
        { key: 'partition.topN', minimum: 1 },
    ])('preserves $key schema, scope and localized description', ({ key, minimum, maximum }) => {
        const schema = registrations.find(([name]) => name === `${overviewPrefix}${key}`)?.[1];
        const descriptionKey = `cosmosdb.configuration.accountOverview.${key}`;
        expect(schema).toMatchObject({ type: 'number', minimum, description: `%${descriptionKey}%` });
        expect(schema).not.toHaveProperty('scope');
        expect(schema && 'maximum' in schema ? schema.maximum : undefined).toBe(maximum);
        expect(new Map(Object.entries(labels)).get(descriptionKey)).toEqual(expect.stringMatching(/\S/));
    });
});
