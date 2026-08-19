/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    API,
    CassandraExperience,
    CoreExperience,
    type Experience,
    getExperienceFromApi,
    GremlinExperience,
    TableExperience,
    tryGetExperience,
} from './AzureDBExperiences';

describe('AzureDBExperiences', () => {
    describe('getExperienceFromApi', () => {
        it('returns the Core experience for the Core API', () => {
            expect(getExperienceFromApi(API.Core)).toBe(CoreExperience);
        });

        it('maps the (retired) Graph API to the Gremlin experience', () => {
            expect(getExperienceFromApi(API.Graph)).toBe(GremlinExperience);
        });

        it('synthesizes a fallback experience for an unmapped API value', () => {
            const result = getExperienceFromApi(API.Common);
            expect(result).toMatchObject({
                api: API.Common,
                shortName: API.Common,
                longName: API.Common,
            });
        });
    });

    describe('tryGetExperience', () => {
        const withCapabilities = (names: string[]): unknown => ({
            capabilities: names.map((name) => ({ name })),
        });

        it('detects Gremlin from the EnableGremlin capability', () => {
            expect(tryGetExperience(withCapabilities(['EnableGremlin']) as never)).toBe(GremlinExperience);
        });

        it('detects Table from the EnableTable capability', () => {
            expect(tryGetExperience(withCapabilities(['EnableTable']) as never)).toBe(TableExperience);
        });

        it('detects Cassandra from the EnableCassandra capability', () => {
            expect(tryGetExperience(withCapabilities(['EnableCassandra']) as never)).toBe(CassandraExperience);
        });

        it('treats an empty capabilities array as the Core experience', () => {
            expect(tryGetExperience(withCapabilities([]) as never)).toBe(CoreExperience);
        });

        it('detects experiences from the defaultExperience tag', () => {
            expect(tryGetExperience({ tags: { defaultExperience: 'Gremlin (graph)' } } as never)).toBe(
                GremlinExperience,
            );
            expect(tryGetExperience({ tags: { defaultExperience: 'Azure Table' } } as never)).toBe(TableExperience);
            expect(tryGetExperience({ tags: { defaultExperience: 'Cassandra' } } as never)).toBe(CassandraExperience);
            expect(tryGetExperience({ tags: { defaultExperience: 'Core (SQL)' } } as never)).toBe(CoreExperience);
        });

        it('falls back to Core when kind is GlobalDocumentDB with no tags/capabilities', () => {
            expect(tryGetExperience({ kind: 'GlobalDocumentDB' } as never)).toBe(CoreExperience);
        });

        it('returns undefined when nothing matches', () => {
            expect(tryGetExperience({ tags: { defaultExperience: 'Unknown' } } as never)).toBeUndefined();
            expect(tryGetExperience({ kind: 'MongoDB' } as never)).toBeUndefined();
        });
    });

    describe('experience constants', () => {
        it('expose a unique api per experience', () => {
            const experiences: Experience[] = [CoreExperience, TableExperience, GremlinExperience, CassandraExperience];
            const apis = experiences.map((e) => e.api);
            expect(new Set(apis).size).toBe(apis.length);
        });
    });
});
