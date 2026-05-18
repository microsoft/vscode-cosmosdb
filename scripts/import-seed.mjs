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
 *   --reset      Drop and recreate the container before importing
 */

import { CosmosClient } from '@azure/cosmos';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI argument parsing ──────────────────────────────────────────────────────
// (parsed before the TLS guard so we can check --endpoint early)

const args = process.argv.slice(2);

function flag(name) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(name) {
    return args.includes(`--${name}`);
}

// The well-known emulator master key — identical on every emulator installation.
// The emulator ships with a single fixed account and this key cannot be changed.
// Override via COSMOS_KEY env var or --key flag only when connecting to a
// non-emulator instance.
// Docs: https://learn.microsoft.com/en-us/azure/cosmos-db/emulator#authentication
const EMULATOR_KEY = 'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';

const endpoint = flag('endpoint') ?? process.env.COSMOS_ENDPOINT;
const key = flag('key') ?? process.env.COSMOS_KEY ?? EMULATOR_KEY;
const databaseId = flag('database') ?? 'nosql-test-db';
const batchSize = parseInt(flag('batch-size') ?? '100', 10);
const importAll = hasFlag('all');
const singleContainer = flag('container');
const reset = hasFlag('reset');

if (!endpoint) {
    console.error('ERROR: Cosmos DB endpoint is required. Set COSMOS_ENDPOINT or pass --endpoint.');
    process.exit(1);
}

if (!importAll && !singleContainer) {
    console.error('ERROR: Specify --container <name> or --all.');
    process.exit(1);
}

// ── Module-level bulk support flag ───────────────────────────────────────────
// Once bulk() fails for any container in this run, skip it for all subsequent
// containers to avoid wasting time on known-unsupported endpoints (e.g. emulator).
let bulkSupported = true;

/**
 * UDFs to register per container.
 * Each entry is { id, body } — body is a JS function string.
 * These are registered idempotently (create → replace on 409).
 *
 * @type {Record<string, { id: string; body: string }[]>}
 */
const CONTAINER_UDFS = {
    products: [
        {
            id: 'formatPrice',
            body: `function formatPrice(price) {
    if (price === null || price === undefined) return null;
    return '$' + Number(price).toFixed(2);
}`,
        },
        {
            id: 'isExpensive',
            body: `function isExpensive(price, threshold) {
    if (price === null || price === undefined) return false;
    if (threshold === null || threshold === undefined) threshold = 100;
    return Number(price) > Number(threshold);
}`,
        },
        {
            id: 'categoryLabel',
            body: `function categoryLabel(category, brand, inStock) {
    var label = (category || 'Unknown') + ' / ' + (brand || 'Unknown');
    if (inStock === false) label += ' [Out of stock]';
    return label;
}`,
        },
    ],
};

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
 * Runs tasks with at most `concurrency` in-flight at a time.
 * @template T
 * @param {(() => Promise<T>)[]} tasks
 * @param {number} concurrency
 * @returns {Promise<T[]>}
 */
async function pLimit(tasks, concurrency) {
    const results = [];
    let index = 0;

    async function worker() {
        while (index < tasks.length) {
            const i = index++;
            results[i] = await tasks[i]();
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
    return results;
}

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
 * Renders a docker-pull style progress bar to stdout.
 * @param {string} label
 * @param {number} done
 * @param {number} total
 * @param {number} batch
 * @param {number} batches
 */
function renderProgress(label, done, total, batch, batches) {
    const BAR_WIDTH = 30;
    const pct = total === 0 ? 1 : Math.min(1, done / total);
    const filled = Math.min(BAR_WIDTH, Math.round(BAR_WIDTH * pct));
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    const pctStr = (pct * 100).toFixed(1).padStart(5);
    process.stdout.write(
        `\r${label.padEnd(12)} [${bar}] ${pctStr}%  ${String(done).padStart(6)}/${total}  batch ${batch}/${batches}`,
    );
    if (done >= total) process.stdout.write('\n');
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
    console.log(
        `[${containerName}] Loaded ${docs.length} documents (${(readFileSync(meta.seedFile).length / 1_048_576).toFixed(1)} MB)`,
    );

    // Ensure database exists
    const { database } = await client.databases.createIfNotExists({ id: databaseId });
    console.log(`[${containerName}] Database "${databaseId}" ready`);

    // Ensure container exists (optionally reset it first)
    if (reset) {
        try {
            await database.container(containerName).delete();
            console.log(`[${containerName}] Container dropped (--reset)`);
        } catch {
            // Container didn't exist yet — that's fine
        }
    }
    const { container } = await database.containers.createIfNotExists({
        id: containerName,
        partitionKey: { paths: [meta.partitionKeyPath] },
    });
    console.log(`[${containerName}] Container "${containerName}" ready (partition key: ${meta.partitionKeyPath})`);

    // ── UDF registration ──────────────────────────────────────────────────
    const udfs = CONTAINER_UDFS[containerName] ?? [];
    for (const udf of udfs) {
        try {
            await container.scripts.userDefinedFunctions.create({ id: udf.id, body: udf.body });
            console.log(`[${containerName}] UDF "${udf.id}" created`);
        } catch (err) {
            if (err.statusCode === 409 || err.code === 409) {
                // Already exists — replace to keep body up to date
                await container.scripts.userDefinedFunction(udf.id).replace({ id: udf.id, body: udf.body });
                console.log(`[${containerName}] UDF "${udf.id}" replaced (already existed)`);
            } else {
                console.warn(
                    `[${containerName}] UDF "${udf.id}" registration failed (statusCode=${err.statusCode ?? err.code}): ${err.message}`,
                );
            }
        }
    }

    // ── Resume support ────────────────────────────────────────────────────
    // Query how many documents already exist. Since upsert is idempotent,
    // we can safely skip batches that are fully covered by the existing count.
    // No state file needed — works identically on local and CI.
    let alreadyInserted = 0;
    try {
        const { resources } = await container.items.query('SELECT VALUE COUNT(1) FROM c').fetchAll();
        alreadyInserted = resources[0] ?? 0;
    } catch {
        // Container empty or query failed — start from the beginning
    }
    const skipBatches = Math.floor(alreadyInserted / batchSize);
    if (skipBatches > 0) {
        console.log(
            `[${containerName}] Resuming — ${alreadyInserted} docs already present, skipping first ${skipBatches} batches`,
        );
    }

    // ── Upsert with bulk → fallback ───────────────────────────────────────
    // Tries bulk API first (faster); falls back to individual upserts with
    // concurrency = min(cpus, 4) if the endpoint does not support it.
    // Once bulk fails once, all subsequent batches skip it.
    const batches = chunks(docs, batchSize);
    let upserted = alreadyInserted;
    // bulkSupported is module-level — persists across containers in the same run

    // Concurrency for individual-upsert fallback: cap at 4 to avoid
    // overwhelming a single-instance endpoint (emulator or small server).
    // Node.js libuv I/O pool default is also 4.
    const concurrency = Math.min(cpus().length, 4);

    for (let i = skipBatches; i < batches.length; i++) {
        const batch = batches[i];

        if (bulkSupported) {
            try {
                const operations = batch.map((doc) => ({ operationType: 'Upsert', resourceBody: doc }));
                const results = await container.items.bulk(operations);
                const failed = results.filter((r) => r.statusCode >= 400);
                if (failed.length > 0) {
                    throw new Error(`${failed.length} failed upserts, first status: ${failed[0].statusCode}`);
                }
            } catch (err) {
                console.warn(
                    `\n[${containerName}] bulk() unsupported (${err.message?.slice(0, 72)}…), switching to individual upserts`,
                );
                bulkSupported = false;
                await pLimit(
                    batch.map((doc) => () => container.items.upsert(doc)),
                    concurrency,
                );
            }
        } else {
            await pLimit(
                batch.map((doc) => () => container.items.upsert(doc)),
                concurrency,
            );
        }

        upserted += batch.length;
        renderProgress(containerName, upserted, docs.length, i + 1, batches.length);
    }

    console.log(`\n[${containerName}] ✓ Done — ${upserted} documents imported.`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const containersToImport = importAll ? Object.keys(CONTAINERS) : [singleContainer];

for (const name of containersToImport) {
    await importContainer(name);
}

console.log('\nAll done.');
