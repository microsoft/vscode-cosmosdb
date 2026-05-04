/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Seed import script for the NoSQL integration test suite.
 *
 * Creates the test database and container if they do not exist, then
 * bulk-upserts all documents from the seed JSON file.
 *
 * Usage:
 *   node scripts/import-seed.mjs --container products|orders|events
 *   node scripts/import-seed.mjs --all
 *
 * Required environment variables (or CLI flags):
 *   COSMOS_ENDPOINT  /  --endpoint  https://localhost:8081
 *   COSMOS_KEY       /  --key       <master-key>
 *
 * Optional:
 *   --database   Name of the test database (default: nosql-test-db)
 *   --batch-size Number of documents per bulk batch (default: 100)
 */

import { CosmosClient } from '@azure/cosmos';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(name) {
    return args.includes(`--${name}`);
}

// The well-known emulator master key — same on every installation.
// Override via COSMOS_KEY env var or --key flag only when connecting to a
// non-emulator instance.
const EMULATOR_KEY =
    'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';

const endpoint = flag('endpoint') ?? process.env.COSMOS_ENDPOINT;
const key = flag('key') ?? process.env.COSMOS_KEY ?? EMULATOR_KEY;
const databaseId = flag('database') ?? 'nosql-test-db';
const batchSize = parseInt(flag('batch-size') ?? '100', 10);
const importAll = hasFlag('all');
const singleContainer = flag('container');

if (!endpoint) {
    console.error('ERROR: Cosmos DB endpoint is required. Set COSMOS_ENDPOINT or pass --endpoint.');
    process.exit(1);
}


if (!importAll && !singleContainer) {
    console.error('ERROR: Specify --container <name> or --all.');
    process.exit(1);
}

// ── Container metadata ────────────────────────────────────────────────────────

/** @type {Record<string, { partitionKeyPath: string; seedFile: string }>} */
const CONTAINERS = {
    products: {
        partitionKeyPath: '/_partitionKey',
        seedFile: resolve(
            __dirname,
            '../packages/nosql-language-service/src/test-fixtures/containers/products.seed.json',
        ),
    },
    orders: {
        partitionKeyPath: '/_partitionKey',
        seedFile: resolve(
            __dirname,
            '../packages/nosql-language-service/src/test-fixtures/containers/orders.seed.json',
        ),
    },
    events: {
        partitionKeyPath: '/_partitionKey',
        seedFile: resolve(
            __dirname,
            '../packages/nosql-language-service/src/test-fixtures/containers/events.seed.json',
        ),
    },
};

// ── Cosmos client ─────────────────────────────────────────────────────────────

const client = new CosmosClient({
    endpoint,
    key,
    // The emulator uses a self-signed certificate; NODE_TLS_REJECT_UNAUTHORIZED=0
    // must be set in the calling environment for local use.
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Splits an array into chunks of at most `size` items.
 * @template T
 * @param {T[]} arr
 * @param {number} size
 * @returns {T[][]}
 */
function chunks(arr, size) {
    const result = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}

/**
 * Imports all documents from a seed file into the given container.
 * @param {string} containerName
 */
async function importContainer(containerName) {
    const meta = CONTAINERS[containerName];
    if (!meta) {
        throw new Error(`Unknown container: "${containerName}". Valid: ${Object.keys(CONTAINERS).join(', ')}`);
    }

    console.log(`\n[${containerName}] Reading seed file: ${meta.seedFile}`);
    const docs = JSON.parse(readFileSync(meta.seedFile, 'utf8'));
    console.log(`[${containerName}] Loaded ${docs.length} documents (${(readFileSync(meta.seedFile).length / 1_048_576).toFixed(1)} MB)`);

    // Ensure database exists
    const { database } = await client.databases.createIfNotExists({ id: databaseId });
    console.log(`[${containerName}] Database "${databaseId}" ready`);

    // Ensure container exists
    const { container } = await database.containers.createIfNotExists({
        id: containerName,
        partitionKey: { paths: [meta.partitionKeyPath] },
    });
    console.log(`[${containerName}] Container "${containerName}" ready (partition key: ${meta.partitionKeyPath})`);

    // Bulk upsert in batches
    const batches = chunks(docs, batchSize);
    let upserted = 0;
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const operations = batch.map((doc) => ({
            operationType: 'Upsert',
            resourceBody: doc,
        }));

        const results = await container.items.bulk(operations);
        const failed = results.filter((r) => r.statusCode >= 400);
        if (failed.length > 0) {
            throw new Error(`[${containerName}] Batch ${i + 1}/${batches.length} had ${failed.length} failed upserts. First error code: ${failed[0].statusCode}`);
        }

        upserted += batch.length;
        process.stdout.write(`\r[${containerName}] Upserted ${upserted}/${docs.length} documents (batch ${i + 1}/${batches.length})`);
    }

    console.log(`\n[${containerName}] ✓ Done — ${upserted} documents imported.`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const containersToImport = importAll ? Object.keys(CONTAINERS) : [singleContainer];

for (const name of containersToImport) {
    await importContainer(name);
}

console.log('\nAll done.');

