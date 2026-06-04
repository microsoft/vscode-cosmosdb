/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generates NoSQL test data whose *inferred schema* is intentionally large
 * (≈5 / 25 / 50 MB), while keeping the document count low (≤1000, default 200–300).
 *
 * Why?  The Cosmos DB local emulator does not support bulk inserts, so importing
 * tens of thousands of documents is impractical.  However, the size of the
 * schema produced by `@cosmosdb/schema-analyzer` is driven by the number of
 * *unique property paths* — not by the document count.  This script exploits
 * that: every record carries many uniquely-named properties so a few hundred
 * documents are enough to balloon the schema to the requested megabytes.
 *
 * Output documents are still valid NoSQL records: each has an `id` and a
 * `_partitionKey`, so they can be imported via `scripts/import-seed.mjs`
 * (which falls back to individual upserts on the emulator).
 *
 * ────────────────────────────────────────────────────────────────────────
 * Dual use: CLI **and** importable module
 * ────────────────────────────────────────────────────────────────────────
 *
 * - Run as a CLI:
 *     node scripts/generate-large-schema-data.mjs --preset small
 *
 * - Import the deterministic generator from tests / other scripts:
 *     import { generateLargeSchemaDocuments, LARGE_SCHEMA_PRESETS }
 *       from '../../scripts/generate-large-schema-data.mjs';
 *
 *   The CLI code is gated behind an `isMainModule` check so importing this
 *   file does NOT trigger argv parsing or file writes.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CLI usage
 * ────────────────────────────────────────────────────────────────────────
 *
 *   # presets (recommended)
 *   node scripts/generate-large-schema-data.mjs --preset small      # ~5 MB schema, 250 docs
 *   node scripts/generate-large-schema-data.mjs --preset medium     # ~25 MB schema, 300 docs
 *   node scripts/generate-large-schema-data.mjs --preset large      # ~50 MB schema, 300 docs
 *
 *   # custom
 *   node scripts/generate-large-schema-data.mjs --target-mb 15 --records 250
 *
 *   # options
 *     --target-mb <n>          Target schema size in MB (pretty-printed JSON). Default: 5
 *     --records <n>            Number of documents to generate (1..1000). Default: 250
 *     --output <path>          Output JSON file. Default: scripts/large-schema-data.<preset|custom>.json
 *     --schema-output <p>      Path for the analyzed schema. Default: <output>.schema.json next to data.
 *     --seed <n>               PRNG seed for deterministic output. Default: 42
 *     --max-depth <n>          Max nested-object depth.  Default: 2 (root → object → leaves).
 *                              Use 3..5 to grow the schema vertically instead of horizontally.
 *     --polymorphism-rate <n>  Probability (0..1) that a property name is drawn from a shared
 *                              pool instead of a unique one.  Default: 0 (no polymorphism).
 *                              Increase to get `anyOf` entries with mixed types/shapes in the
 *                              inferred schema.
 *     --no-schema              Don't run the analyzer / don't write the schema file.
 *     --pretty                 Pretty-print the output JSON (default: true)
 *     --no-pretty              Compact output JSON
 *
 * For every successful run two files are produced (unless --no-schema is set):
 *
 *   <output>           — the document collection (array of records)
 *   <output>.schema.json
 *                      — the JSON Schema inferred from those documents by
 *                        `@cosmosdb/schema-analyzer` (pretty-printed). Suitable
 *                        as a test fixture.
 *
 * Output is fully deterministic for a given (seed, records, target-mb).
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ────────────────────────────────────────────────────────────────────────
// Deterministic PRNG (mulberry32) — matches generate-nosql-seed.mjs
// ────────────────────────────────────────────────────────────────────────

export function createPrng(seed) {
    let state = seed >>> 0;
    return function rand() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function makeHelpers(seed) {
    const rand = createPrng(seed);
    const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
    const float = (min, max, dp = 2) => parseFloat((rand() * (max - min) + min).toFixed(dp));
    const bool = (p = 0.5) => rand() < p;
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const isoDate = (start, end) =>
        new Date(Math.floor(rand() * (end - start)) + start).toISOString().replace(/\.\d{3}Z$/, '.000Z');
    return { rand, int, float, bool, pick, isoDate };
}

// ────────────────────────────────────────────────────────────────────────
// Pools (property-name stems / value pools)
// ────────────────────────────────────────────────────────────────────────

// A reasonably broad pool of "realistic looking" stems.  Real uniqueness comes
// from appending a base-36 record + local index, but mixing stems keeps the
// output looking like real-world fields rather than `f1_2_3`.
const STEMS = [
    'metric',
    'sensor',
    'reading',
    'sample',
    'event',
    'trace',
    'span',
    'detail',
    'attribute',
    'feature',
    'flag',
    'tag',
    'param',
    'option',
    'setting',
    'preference',
    'config',
    'meta',
    'context',
    'session',
    'channel',
    'pipeline',
    'queue',
    'topic',
    'partition',
    'shard',
    'region',
    'zone',
    'cluster',
    'node',
    'service',
    'route',
    'endpoint',
    'host',
    'port',
    'token',
    'claim',
    'scope',
    'permission',
    'role',
    'group',
    'team',
    'project',
    'workspace',
    'tenant',
    'account',
    'profile',
    'user',
    'device',
    'client',
    'agent',
    'subject',
    'object',
    'entity',
    'item',
    'record',
    'note',
    'log',
    'audit',
    'invoice',
    'order',
    'quote',
    'plan',
    'task',
    'job',
    'step',
    'stage',
    'phase',
    'milestone',
    'goal',
    'kpi',
    'score',
    'rating',
    'rank',
    'level',
    'grade',
    'tier',
    'category',
    'segment',
    'cohort',
    'bucket',
    'window',
    'frame',
    'slice',
    'snapshot',
    'checkpoint',
    'revision',
    'version',
    'release',
    'build',
    'patch',
    'hotfix',
    'feature',
    'experiment',
    'variant',
    'campaign',
    'channel',
    'medium',
    'source',
    'target',
    'origin',
    'destination',
    'lane',
    'queue',
];

const SUFFIXES = [
    'Id',
    'Code',
    'Key',
    'Hash',
    'Ref',
    'Name',
    'Label',
    'Value',
    'Count',
    'Total',
    'Sum',
    'Avg',
    'Min',
    'Max',
    'Rate',
    'Ratio',
    'Pct',
    'Index',
    'Order',
    'Status',
    'State',
    'Flag',
    'Mode',
    'Kind',
    'Type',
    'Source',
    'Target',
    'Note',
    'Desc',
    'Info',
    'Data',
    'Payload',
    'Meta',
    'Tag',
    'Marker',
];

const WORDS = [
    'alpha',
    'bravo',
    'charlie',
    'delta',
    'echo',
    'foxtrot',
    'golf',
    'hotel',
    'india',
    'juliet',
    'kilo',
    'lima',
    'mike',
    'november',
    'oscar',
    'papa',
    'quebec',
    'romeo',
    'sierra',
    'tango',
    'uniform',
    'victor',
    'whiskey',
    'xray',
    'yankee',
    'zulu',
];

const PARTITION_KEYS = ['shard-a', 'shard-b', 'shard-c', 'shard-d', 'shard-e'];
const FIXED_STATUSES = ['active', 'pending', 'archived', 'draft'];

// ────────────────────────────────────────────────────────────────────────
// Defaults
// ────────────────────────────────────────────────────────────────────────

/**
 * Empirically observed average byte cost of one extra unique leaf property
 * in the pretty-printed JSON schema produced by `@cosmosdb/schema-analyzer`
 * after `simplifySchema()`.  Used only to *estimate* `propsPerRecord` —
 * actual delta vs. target is reported by the CLI for visibility.
 */
export const DEFAULT_AVG_BYTES_PER_LEAF = 250;

/** Fraction of generated leaves placed under nested object containers. */
export const DEFAULT_NESTING_RATIO = 0.3;

/** Default PRNG seed — kept stable so test snapshots don't drift. */
export const DEFAULT_SEED = 42;

/**
 * Hard cap on nested-object depth.  Each level adds an intermediate
 * container schema (extra bytes) plus another generation of sub-leaves,
 * so growing this is an alternative to growing `propsPerRecord` for
 * hitting a target schema size.
 *
 * Depth conventions match the rest of the codebase (see
 * `computeMaxDepth` in `SchemaService.ts`): the root is depth 0, a root
 * leaf is depth 1, an object value of a root entry is depth 2, that
 * object's children are at depth 3, etc.  Default = 2 preserves the
 * historical "root → object → leaves" shape.
 */
export const DEFAULT_MAX_NESTING_DEPTH = 2;

/**
 * Probability (0..1) that a generated property name is drawn from the
 * shared `POLYMORPHIC_NAMES` pool instead of a unique `_<rec>_<idx>`
 * suffix.  Shared names mean the same path appears in many documents,
 * which — when their values have different types/shapes — produces
 * polymorphic `anyOf` entries in the inferred schema.
 *
 * Default = 0: every property name is unique, no polymorphism.
 */
export const DEFAULT_POLYMORPHISM_RATE = 0;

/**
 * Pool of "ordinary" property names shared across documents.  When
 * `polymorphismRate > 0`, the generator occasionally picks from here
 * instead of minting a unique name, so the inferred schema accumulates
 * polymorphic entries (string in record A, object in record B, …).
 */
const POLYMORPHIC_NAMES = [
    'value',
    'data',
    'info',
    'detail',
    'meta',
    'config',
    'state',
    'label',
    'code',
    'status',
    'kind',
    'mode',
    'attrs',
    'props',
    'ref',
    'target',
    'source',
    'origin',
    'context',
    'history',
    'count',
    'amount',
    'score',
    'flag',
    'tag',
    'note',
    'extra',
    'payload',
    'summary',
    'metric',
];

/** Ready-made (targetMB, records) tuples used by both the CLI presets and tests. */
export const LARGE_SCHEMA_PRESETS = Object.freeze({
    small: { targetMB: 5, records: 250 },
    medium: { targetMB: 25, records: 300 },
    large: { targetMB: 50, records: 300 },
});

// ────────────────────────────────────────────────────────────────────────
// Value generators
// ────────────────────────────────────────────────────────────────────────

function randomLeafValue(h) {
    const r = h.rand();
    if (r < 0.25) return h.int(0, 100_000);
    if (r < 0.4) return h.float(-1000, 1000);
    if (r < 0.55) return `${h.pick(WORDS)}-${h.int(1, 9999)}`;
    if (r < 0.7) return h.bool();
    if (r < 0.8) return h.isoDate(new Date('2020-01-01').getTime(), new Date('2026-12-31').getTime());
    if (r < 0.85) return null;
    if (r < 0.95) return h.pick(WORDS);
    return h.int(-500, 500);
}

/**
 * Builds a unique-yet-realistic property name for a given (recordIdx, localIdx).
 *
 * Uniqueness is guaranteed across all (recordIdx, localIdx) pairs because
 * (recordIdx, localIdx) is encoded in the final segment.
 */
function makeUniquePropName(h, recordIdx, localIdx) {
    const stem = h.pick(STEMS);
    const suffix = h.pick(SUFFIXES);
    return `${stem}${suffix}_${recordIdx.toString(36)}_${localIdx.toString(36)}`;
}

/**
 * Returns either a fresh unique name or — with probability
 * `polymorphismRate` — a name reused from `POLYMORPHIC_NAMES`.
 *
 * Critical invariant: when `polymorphismRate === 0`, this MUST NOT consume
 * any PRNG state beyond what `makeUniquePropName` does.  Otherwise the
 * mere existence of the new parameter would drift the byte stream and
 * invalidate every committed snapshot.  The `polymorphismRate > 0 && …`
 * short-circuit guarantees the call to `h.rand()` only happens when the
 * caller has actually opted into polymorphism.
 */
function pickPropName(h, recordIdx, localIdx, polymorphismRate) {
    if (polymorphismRate > 0 && h.rand() < polymorphismRate) {
        return h.pick(POLYMORPHIC_NAMES);
    }
    return makeUniquePropName(h, recordIdx, localIdx);
}

// ────────────────────────────────────────────────────────────────────────
// Record generation
// ────────────────────────────────────────────────────────────────────────

/**
 * Builds one nested object's contents.  Recurses up to `maxDepth`, where
 * each recursion adds an intermediate container schema in the output.
 *
 * `localIdx` is a mutable counter (`{ v: number }`) shared across the
 * entire record so every minted unique name stays globally distinct
 * within that record.
 *
 * Same invariant as `pickPropName`: when `depth >= maxDepth`, the
 * "recurse deeper?" `h.rand()` call is short-circuited so that the
 * default `maxDepth === 2` configuration produces byte-for-byte the
 * same PRNG sequence (and therefore the same documents) as the
 * pre-refactor flat generator.
 */
function buildNestedObject({ h, depth, maxDepth, recordIdx, localIdx, nestingRatio, polymorphismRate, subCount }) {
    const obj = {};
    let leavesAdded = 0;

    for (let j = 0; j < subCount; j++) {
        const subName = pickPropName(h, recordIdx, localIdx.v++, polymorphismRate);

        if (depth < maxDepth && h.rand() < nestingRatio) {
            // Recurse: this sub-property is itself a nested object.  Use a
            // smaller fan-out (2..4) at deeper levels so the schema doesn't
            // explode exponentially with depth.
            const childCount = h.int(2, 4);
            const { value, leavesAdded: childLeaves } = buildNestedObject({
                h,
                depth: depth + 1,
                maxDepth,
                recordIdx,
                localIdx,
                nestingRatio,
                polymorphismRate,
                subCount: childCount,
            });
            obj[subName] = value;
            leavesAdded += childLeaves;
        } else {
            obj[subName] = randomLeafValue(h);
            leavesAdded += 1;
        }
    }

    return { value: obj, leavesAdded };
}

function generateRecord({ globalH, seed, recordIdx, propsPerRecord, nestingRatio, maxNestingDepth, polymorphismRate }) {
    // Independent per-record PRNG keeps generation order-independent and
    // makes recordIdx the only thing that matters for a record's contents.
    const h = makeHelpers(seed + recordIdx * 7919);

    const record = {
        id: `doc-${String(recordIdx).padStart(5, '0')}`,
        _partitionKey: PARTITION_KEYS[recordIdx % PARTITION_KEYS.length],
        // A handful of shared (cross-record) "stable" fields — they collapse to
        // a single schema entry and don't inflate size, but make documents look
        // realistic.
        status: globalH.pick(FIXED_STATUSES),
        createdAt: globalH.isoDate(new Date('2024-01-01').getTime(), new Date('2026-06-01').getTime()),
        sequence: recordIdx,
    };

    const localIdx = { v: 0 };
    let leavesPlaced = 0;

    while (leavesPlaced < propsPerRecord) {
        const remaining = propsPerRecord - leavesPlaced;

        if (h.rand() < nestingRatio && remaining >= 3) {
            // Nested object with 3-6 sub-entries.  At default depth this
            // produces a single layer of leaves; with higher
            // `maxNestingDepth` `buildNestedObject` may recurse further.
            const subCount = Math.min(remaining, h.int(3, 6));
            const objName = pickPropName(h, recordIdx, localIdx.v++, polymorphismRate);
            const { value, leavesAdded } = buildNestedObject({
                h,
                depth: 2, // the object itself sits at depth=2 (root=0, root-prop=1, root-prop's value=2)
                maxDepth: maxNestingDepth,
                recordIdx,
                localIdx,
                nestingRatio,
                polymorphismRate,
                subCount,
            });
            record[objName] = value;
            leavesPlaced += leavesAdded;
        } else {
            const name = pickPropName(h, recordIdx, localIdx.v++, polymorphismRate);
            record[name] = randomLeafValue(h);
            leavesPlaced += 1;
        }
    }

    return record;
}

// ────────────────────────────────────────────────────────────────────────
// Public generator API
// ────────────────────────────────────────────────────────────────────────

/**
 * Computes how many unique leaves per record are needed to hit `targetMB`
 * with `recordCount` documents, then generates a deterministic document
 * array that explodes the inferred schema accordingly.
 *
 * Same `(seed, recordCount, targetMB, avgBytesPerLeaf, nestingRatio,
 * maxNestingDepth, polymorphismRate)` → byte-for-byte identical output on
 * every run, on every platform.
 *
 * @param {object} options
 * @param {number} options.targetMB             Target schema size in MB (pretty-printed JSON).
 * @param {number} [options.recordCount=250]    Number of documents to produce (1..1000).
 * @param {number} [options.seed=42]            PRNG seed.
 * @param {number} [options.avgBytesPerLeaf]    Override the leaf-cost estimate.
 * @param {number} [options.nestingRatio]       Fraction of root entries (and at each level when
 *                                              `maxNestingDepth > 2`, sub-entries) placed under
 *                                              nested objects rather than emitted as leaves.
 * @param {number} [options.maxNestingDepth=2]  Hard cap on nested-object depth.  Default mirrors
 *                                              the historical flat output.
 * @param {number} [options.polymorphismRate=0] Probability (0..1) that each generated property
 *                                              name is drawn from the shared `POLYMORPHIC_NAMES`
 *                                              pool instead of a unique one — controls how many
 *                                              `anyOf` entries appear in the inferred schema.
 * @returns {{ documents: Record<string, unknown>[]; propsPerRecord: number; totalLeavesNeeded: number; }}
 */
export function generateLargeSchemaDocuments({
    targetMB,
    recordCount = 250,
    seed = DEFAULT_SEED,
    avgBytesPerLeaf = DEFAULT_AVG_BYTES_PER_LEAF,
    nestingRatio = DEFAULT_NESTING_RATIO,
    maxNestingDepth = DEFAULT_MAX_NESTING_DEPTH,
    polymorphismRate = DEFAULT_POLYMORPHISM_RATE,
}) {
    if (typeof targetMB !== 'number' || targetMB <= 0) {
        throw new Error(`generateLargeSchemaDocuments: targetMB must be a positive number, got ${targetMB}`);
    }
    if (!Number.isInteger(recordCount) || recordCount < 1 || recordCount > 1000) {
        throw new Error(
            `generateLargeSchemaDocuments: recordCount must be an integer in [1, 1000], got ${recordCount}`,
        );
    }
    if (!Number.isInteger(maxNestingDepth) || maxNestingDepth < 1) {
        throw new Error(
            `generateLargeSchemaDocuments: maxNestingDepth must be a positive integer, got ${maxNestingDepth}`,
        );
    }
    if (typeof polymorphismRate !== 'number' || polymorphismRate < 0 || polymorphismRate > 1) {
        throw new Error(`generateLargeSchemaDocuments: polymorphismRate must be in [0, 1], got ${polymorphismRate}`);
    }

    const targetBytes = targetMB * 1024 * 1024;
    // Subtract a small fixed overhead for the root schema + shared fields.
    const overheadBytes = 2_000;
    const totalLeavesNeeded = Math.max(recordCount, Math.ceil((targetBytes - overheadBytes) / avgBytesPerLeaf));
    const propsPerRecord = Math.max(1, Math.ceil(totalLeavesNeeded / recordCount));

    const globalH = makeHelpers(seed);
    const documents = [];
    for (let i = 0; i < recordCount; i++) {
        documents.push(
            generateRecord({
                globalH,
                seed,
                recordIdx: i,
                propsPerRecord,
                nestingRatio,
                maxNestingDepth,
                polymorphismRate,
            }),
        );
    }

    return { documents, propsPerRecord, totalLeavesNeeded };
}

// ────────────────────────────────────────────────────────────────────────
// CLI (only runs when this file is invoked directly via `node ...mjs`)
// ────────────────────────────────────────────────────────────────────────

const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const args = process.argv.slice(2);

    const flag = (name, defaultValue) => {
        const idx = args.indexOf(`--${name}`);
        return idx === -1 ? defaultValue : args[idx + 1];
    };
    const hasFlag = (name) => args.includes(`--${name}`);

    const presetName = flag('preset');
    const preset = presetName ? LARGE_SCHEMA_PRESETS[presetName] : undefined;
    if (presetName && !preset) {
        console.error(`ERROR: unknown preset "${presetName}". Valid: ${Object.keys(LARGE_SCHEMA_PRESETS).join(', ')}`);
        process.exit(1);
    }

    const targetMB = parseFloat(flag('target-mb', preset?.targetMB ?? 5));
    const recordCount = Math.min(1000, Math.max(1, parseInt(flag('records', preset?.records ?? 250), 10)));
    const seed = parseInt(flag('seed', DEFAULT_SEED), 10);
    const maxNestingDepth = Math.max(1, parseInt(flag('max-depth', DEFAULT_MAX_NESTING_DEPTH), 10));
    const polymorphismRate = Math.min(1, Math.max(0, parseFloat(flag('polymorphism-rate', DEFAULT_POLYMORPHISM_RATE))));
    const writeSchema = !hasFlag('no-schema');
    const pretty = !hasFlag('no-pretty');

    const defaultOutputName = presetName
        ? `large-schema-data.${presetName}.json`
        : `large-schema-data.${targetMB}mb-${recordCount}docs.json`;
    const outputPath = resolve(flag('output') ?? resolve(__dirname, defaultOutputName));
    const schemaOutputPath = resolve(flag('schema-output') ?? `${outputPath}.schema.json`);

    const { documents, propsPerRecord, totalLeavesNeeded } = generateLargeSchemaDocuments({
        targetMB,
        recordCount,
        seed,
        maxNestingDepth,
        polymorphismRate,
    });

    console.log('▶ Generation plan');
    console.log(`  preset:           ${presetName ?? '(custom)'}`);
    console.log(`  target schema:    ~${targetMB} MB`);
    console.log(`  records:          ${recordCount}`);
    console.log(`  seed:             ${seed}`);
    console.log(`  unique leaves:    ~${totalLeavesNeeded.toLocaleString()} total`);
    console.log(`  per record:       ~${propsPerRecord} unique props`);
    console.log(`  nesting ratio:    ${(DEFAULT_NESTING_RATIO * 100).toFixed(0)} %`);
    console.log(`  max nesting depth:${maxNestingDepth}`);
    console.log(`  polymorphism rate:${(polymorphismRate * 100).toFixed(0)} %`);
    console.log(`  output (data):    ${outputPath}`);
    if (writeSchema) {
        console.log(`  output (schema):  ${schemaOutputPath}`);
    }
    console.log();

    console.log('▶ Writing output…');
    const json = pretty ? JSON.stringify(documents, null, 2) : JSON.stringify(documents);
    writeFileSync(outputPath, json, 'utf-8');
    const dataMB = Buffer.byteLength(json) / 1024 / 1024;
    console.log(`  ✓ Wrote ${documents.length} documents → ${outputPath}`);
    console.log(`  data file size:   ${dataMB.toFixed(2)} MB`);

    if (writeSchema) {
        console.log();
        console.log('▶ Building schema with @cosmosdb/schema-analyzer…');
        const analyzerPath = resolve(__dirname, '../packages/schema-analyzer/dist/esm/json/index.js');
        try {
            const analyzer = await import(pathToFileURL(analyzerPath).href);
            const t0 = performance.now();
            const schema = analyzer.getSchemaFromDocuments(documents);
            const analyzeMs = performance.now() - t0;

            const prettySchema = JSON.stringify(schema, null, 2);
            const compactSchema = JSON.stringify(schema);
            const schemaPrettyMB = Buffer.byteLength(prettySchema) / 1024 / 1024;
            const schemaCompactMB = Buffer.byteLength(compactSchema) / 1024 / 1024;

            writeFileSync(schemaOutputPath, prettySchema, 'utf-8');

            console.log(`  ✓ Wrote schema → ${schemaOutputPath}`);
            console.log(`  schema (pretty):  ${schemaPrettyMB.toFixed(2)} MB  (target ~${targetMB} MB)`);
            console.log(`  schema (compact): ${schemaCompactMB.toFixed(2)} MB`);
            console.log(`  analyze time:     ${analyzeMs.toFixed(0)} ms`);

            const deltaPct = ((schemaPrettyMB - targetMB) / targetMB) * 100;
            const sign = deltaPct >= 0 ? '+' : '';
            console.log(`  delta vs target:  ${sign}${deltaPct.toFixed(1)} %`);

            if (Math.abs(deltaPct) > 25) {
                console.log();
                console.log(
                    `  ⚠  Schema size is more than 25 % off target.  ` +
                        `Tune DEFAULT_AVG_BYTES_PER_LEAF (currently ${DEFAULT_AVG_BYTES_PER_LEAF}) ` +
                        `or pass a different --records / --target-mb combination.`,
                );
            }
        } catch (err) {
            console.warn(`  ⚠  Could not analyze — @cosmosdb/schema-analyzer not built?`);
            console.warn(`     Run: npm run build  (or build the schema-analyzer package)`);
            console.warn(`     Error: ${err.message}`);
            process.exitCode = 1;
        }
    }

    console.log();
    console.log('Done.');
}
