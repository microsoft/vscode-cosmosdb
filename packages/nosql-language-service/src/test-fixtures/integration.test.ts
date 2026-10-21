/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Integration test suite for the Cosmos DB query language SELECT fixtures.
 *
 * **Requires a running Cosmos DB Emulator.**
 * Query execution is skipped when the COSMOS_ENDPOINT environment variable is not set.
 * Client TLS configuration checks always run, including in the offline unit-test suite.
 *
 * Environment variables:
 *   COSMOS_ENDPOINT  — emulator URL, e.g. https://localhost:8081
 *   COSMOS_KEY       — emulator master key
 *   COSMOS_DATABASE  — database name (default: nosql-test-db)
 *
 * HTTPS loopback endpoints using the well-known emulator key get a client-scoped
 * certificate exception. Other HTTPS connections retain normal certificate validation.
 */

import { type Container, CosmosClient, type CosmosClientOptions, type SqlQuerySpec } from '@azure/cosmos';
import { readFileSync } from 'node:fs';
import { Agent, globalAgent } from 'node:https';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures as negativeIntegrationFixtures } from './queries/negative-integration.js';
import { fixtures as selectBasicFixtures } from './queries/select-basic.js';
import { fixtures as selectComplexFixtures } from './queries/select-complex.js';
import { fixtures as selectFromJoinFixtures } from './queries/select-from-join.js';
import { fixtures as selectFunctionsFixtures } from './queries/select-functions.js';
import { fixtures as selectGroupByOrderByFixtures } from './queries/select-groupby-orderby.js';
import { fixtures as selectTypeConversionFixtures } from './queries/select-type-conversion.js';
import { fixtures as selectWhereFixtures } from './queries/select-where.js';
import { type QueryFixture } from './queries/types.js';

// ── Environment guard ─────────────────────────────────────────────────────────

const endpoint = process.env.COSMOS_ENDPOINT;
// The well-known emulator master key — identical on every emulator installation.
// The emulator ships with a single fixed account and this key cannot be changed.
// Override via COSMOS_KEY only when connecting to a non-emulator instance.
// Docs: https://learn.microsoft.com/en-us/azure/cosmos-db/emulator#authentication
const emulatorMasterKey = 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';
const masterKey = process.env.COSMOS_KEY ?? emulatorMasterKey;
const databaseId = process.env.COSMOS_DATABASE ?? 'nosql-test-db';

function getClientOptions(endpoint: string, key: string): CosmosClientOptions {
    const options: CosmosClientOptions = { endpoint, key };
    const url = new URL(endpoint);
    if (
        url.protocol === 'https:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        key === emulatorMasterKey
    ) {
        options.agent = new Agent({ rejectUnauthorized: false });
        // Keep the certificate exception on the requested emulator, not server-advertised endpoints.
        options.connectionPolicy = { enableEndpointDiscovery: false };
    }
    return options;
}

describe('integration client TLS configuration', () => {
    it.each(['https://localhost:8081', 'https://127.0.0.1:8082', 'https://[::1]:8081', 'https://LOCALHOST:8081/'])(
        'scopes the emulator certificate exception to %s',
        (endpoint) => {
            const tlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
            const globalVerification = globalAgent.options.rejectUnauthorized;
            const options = getClientOptions(endpoint, emulatorMasterKey);

            try {
                expect(options.endpoint).toBe(endpoint);
                expect(options.key).toBe(emulatorMasterKey);
                expect(options.agent).toBeInstanceOf(Agent);
                expect(options.agent).toMatchObject({ options: { rejectUnauthorized: false } });
                expect(options.connectionPolicy).toEqual({ enableEndpointDiscovery: false });
                expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe(tlsSetting);
                expect(globalAgent.options.rejectUnauthorized).toBe(globalVerification);
            } finally {
                options.agent?.destroy();
            }
        },
    );

    it.each([
        { endpoint: 'https://cosmos.example.invalid', key: emulatorMasterKey },
        { endpoint: 'https://localhost.example.invalid:8081', key: emulatorMasterKey },
        { endpoint: 'https://localhost@cosmos.example.invalid:8081', key: emulatorMasterKey },
        { endpoint: 'https://192.0.2.1:8081', key: emulatorMasterKey },
        { endpoint: 'https://localhost:8081', key: 'custom-test-key' },
        { endpoint: 'https://127.0.0.1:8081', key: 'custom-test-key' },
        { endpoint: 'https://[::1]:8081', key: 'custom-test-key' },
        { endpoint: 'http://localhost:8081', key: emulatorMasterKey },
    ])('preserves default client options for $endpoint with key $key', ({ endpoint, key }) => {
        expect(getClientOptions(endpoint, key)).toEqual({ endpoint, key });
    });

    it('keeps the integration workflow free of process-wide TLS overrides', () => {
        const workflow = readFileSync(
            new URL('../../../../.github/workflows/nosql-language-service.yml', import.meta.url),
            'utf8',
        );
        expect(workflow).not.toMatch(/^\s*NODE_TLS_REJECT_UNAUTHORIZED\s*:/m);
    });
});

// oxlint-disable-next-line
if (!endpoint) {
    // oxlint-disable-next-line vitest/no-disabled-tests
    describe.skip('integration tests (no emulator — set COSMOS_ENDPOINT to enable)', () => {
        // oxlint-disable-next-line vitest/no-disabled-tests
        it.skip('skipped', () => {});
    });
} else {
    // ── Client setup ────────────────────────────────────────────────────────

    const clientOptions = getClientOptions(endpoint, masterKey);
    const client = new CosmosClient(clientOptions);

    /** Cache of { containerId → CosmosContainer } to avoid repeated lookups. */
    const containerCache = new Map<string, Container>();

    beforeAll(async () => {
        const db = client.database(databaseId);
        for (const name of ['products', 'orders', 'events']) {
            containerCache.set(name, db.container(name));
        }
    });

    afterAll(async () => {
        client.dispose?.();
        clientOptions.agent?.destroy();
    });

    // ── Query helper ────────────────────────────────────────────────────────

    /**
     * Runs a query against the specified container.
     * Returns the items array or throws on error.
     */
    // oxlint-disable-next-line no-inner-declarations
    async function runQuery(containerName: string, sql: string): Promise<unknown[]> {
        const container = containerCache.get(containerName);
        if (!container) throw new Error(`Container not in cache: ${containerName}`);

        const spec: SqlQuerySpec = { query: sql };
        const { resources } = await container.items.query(spec, { maxItemCount: -1 }).fetchAll();
        return resources;
    }

    // ── All positive fixtures ───────────────────────────────────────────────

    const allPositiveFixtures: QueryFixture[] = [
        ...selectBasicFixtures,
        ...selectFromJoinFixtures,
        ...selectWhereFixtures,
        ...selectFunctionsFixtures,
        ...selectGroupByOrderByFixtures,
        ...selectComplexFixtures,
        ...selectTypeConversionFixtures,
    ];

    describe('integration — positive queries (must not throw)', () => {
        for (const f of allPositiveFixtures) {
            // Skip fixtures with parameters — they need explicit values
            if (f.query.includes('@')) continue;

            it(`${f.id}: ${f.description}`, async () => {
                try {
                    const items = await runQuery(f.container, f.query);

                    if (f.expectMinRows !== undefined) {
                        // oxlint-disable-next-line vitest/no-conditional-expect
                        expect(items.length, `[${f.id}] expected ≥ ${f.expectMinRows} rows`).toBeGreaterThanOrEqual(
                            f.expectMinRows,
                        );
                    }
                    if (f.expectMaxRows !== undefined) {
                        // oxlint-disable-next-line vitest/no-conditional-expect
                        expect(items.length, `[${f.id}] expected ≤ ${f.expectMaxRows} rows`).toBeLessThanOrEqual(
                            f.expectMaxRows,
                        );
                    }
                } catch (err) {
                    if (f.knownLimitation) {
                        console.warn(`[${f.id}] known limitation — ${f.knownLimitation}: ${(err as Error).message}`);
                    } else {
                        throw err;
                    }
                }
            });
        }
    });

    // ── Negative fixtures ────────────────────────────────────────────────────

    describe('integration — negative queries (must return 0 rows or throw)', () => {
        for (const f of negativeIntegrationFixtures) {
            it(`${f.id}: ${f.description}`, async () => {
                if (f.expectError) {
                    // Expect the SDK to throw (e.g. UDF not registered).
                    // require-to-throw-message: negative fixtures only assert that *some* error is thrown; the SDK message is not stable.
                    // oxlint-disable-next-line vitest/no-conditional-expect, vitest/require-to-throw-message
                    await expect(runQuery(f.container, f.query)).rejects.toThrow();
                } else {
                    const items = await runQuery(f.container, f.query);
                    if (f.expectMaxRows === 0) {
                        // oxlint-disable-next-line vitest/no-conditional-expect
                        expect(items.length, `[${f.id}] expected 0 rows`).toBe(0);
                    }
                }
            });
        }
    });
}
