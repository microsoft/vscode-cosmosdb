/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Integration test suite for the NoSQL SELECT query fixtures.
 *
 * **Requires a running Cosmos DB Emulator.**
 * The suite is automatically skipped when the COSMOS_ENDPOINT environment
 * variable is not set, so it is safe to include in the package without
 * breaking the offline unit-test run.
 *
 * Environment variables:
 *   COSMOS_ENDPOINT  — emulator URL, e.g. https://localhost:8081
 *   COSMOS_KEY       — emulator master key
 *   COSMOS_DATABASE  — database name (default: nosql-test-db)
 *
 * Set NODE_TLS_REJECT_UNAUTHORIZED=0 when using the self-signed emulator cert.
 */

import { type Container, CosmosClient, type SqlQuerySpec } from '@azure/cosmos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixtures as negativeIntegrationFixtures } from './queries/negative-integration.js';
import { fixtures as selectBasicFixtures } from './queries/select-basic.js';
import { fixtures as selectComplexFixtures } from './queries/select-complex.js';
import { fixtures as selectFromJoinFixtures } from './queries/select-from-join.js';
import { fixtures as selectFunctionsFixtures } from './queries/select-functions.js';
import { fixtures as selectGroupByOrderByFixtures } from './queries/select-groupby-orderby.js';
import { fixtures as selectTypeConversionFixtures } from './queries/select-type-conversion.js';
import { fixtures as selectWhereFixtures } from './queries/select-where.js';
import type { QueryFixture } from './queries/types.js';

// ── Environment guard ─────────────────────────────────────────────────────────

const endpoint = process.env.COSMOS_ENDPOINT;
// The well-known emulator master key — identical on every emulator installation.
// The emulator ships with a single fixed account and this key cannot be changed.
// Override via COSMOS_KEY only when connecting to a non-emulator instance.
// Docs: https://learn.microsoft.com/en-us/azure/cosmos-db/emulator#authentication
const masterKey =
    process.env.COSMOS_KEY ??
    'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';
const databaseId = process.env.COSMOS_DATABASE ?? 'nosql-test-db';

if (!endpoint) {
    describe.skip('integration tests (no emulator — set COSMOS_ENDPOINT to enable)', () => {
        it.skip('skipped', () => {});
    });
} else {
    // ── Client setup ────────────────────────────────────────────────────────

    const client = new CosmosClient({ endpoint, key: masterKey });

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
    });

    // ── Query helper ────────────────────────────────────────────────────────

    /**
     * Runs a SQL query against the specified container.
     * Returns the items array or throws on error.
     */
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
                        expect(items.length, `[${f.id}] expected ≥ ${f.expectMinRows} rows`).toBeGreaterThanOrEqual(
                            f.expectMinRows,
                        );
                    }
                    if (f.expectMaxRows !== undefined) {
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
                    // Expect the SDK to throw (e.g. UDF not registered)
                    await expect(runQuery(f.container, f.query)).rejects.toThrow();
                } else {
                    const items = await runQuery(f.container, f.query);
                    if (f.expectMaxRows === 0) {
                        expect(items.length, `[${f.id}] expected 0 rows`).toBe(0);
                    }
                }
            });
        }
    });
}
