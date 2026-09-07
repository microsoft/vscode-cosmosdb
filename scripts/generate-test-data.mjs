/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Generates 10,000 JSON records for NoSQL database testing.
 *
 * - 5 fixed properties (same name in every record) with primitive values
 * - 5 "varying" properties whose names differ slightly across records
 *   (no more than 10 unique names per slot), with complex nested object values
 *   (depth ≤ 3, ~5 properties each, mix of objects, arrays, primitives)
 *
 * Usage:
 *   node scripts/generate-test-data.mjs [outputPath]
 *   node scripts/generate-test-data.mjs [outputPath] --binary [--binary-bytes <n>]
 *
 * `--binary` adds a base64-encoded `binaryData` field to every document.
 * `--binary-bytes` controls the decoded payload size per document and defaults
 * to 12 KiB, producing an output file of roughly 200 MiB with 10,000 records.
 *
 * Default output: scripts/test-data.json
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
};
const hasFlag = (name) => args.includes(`--${name}`);
const outputArgument = args[0]?.startsWith('--') ? undefined : args[0];
const OUTPUT = resolve(outputArgument ?? `${__dirname}/test-data.json`);
const RECORD_COUNT = 10_000;
const INCLUDE_BINARY_DATA = hasFlag('binary');
const BINARY_BYTES = Number.parseInt(flag('binary-bytes') ?? `${12 * 1024}`, 10);

if (!Number.isSafeInteger(BINARY_BYTES) || BINARY_BYTES < 0) {
    throw new Error(`--binary-bytes must be a non-negative integer, got "${flag('binary-bytes')}"`);
}

// ── helpers ──────────────────────────────────────────────────────────

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max, decimals = 2) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function pick(arr) {
    return arr[randomInt(0, arr.length - 1)];
}

function randomString(len = 8) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let s = '';
    for (let i = 0; i < len; i++) s += chars[randomInt(0, chars.length - 1)];
    return s;
}

function randomWord() {
    const words = [
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
    return pick(words);
}

function randomBool() {
    return Math.random() < 0.5;
}

function randomDate() {
    const start = new Date(2018, 0, 1).getTime();
    const end = new Date(2026, 2, 30).getTime();
    return new Date(randomInt(start, end)).toISOString();
}

// ── primitive value generators ───────────────────────────────────────

const primitiveGenerators = [
    () => randomInt(0, 100_000),
    () => randomFloat(-1000, 1000),
    () => `${randomWord()}_${randomString(4)}`,
    () => randomBool(),
    () => randomDate(),
    () => null,
    () => randomWord(),
    () => randomInt(-500, 500),
];

function randomPrimitive() {
    return pick(primitiveGenerators)();
}

// ── complex value generators (depth ≤ 3) ─────────────────────────────

function randomArray(depth) {
    const len = randomInt(1, 5);
    const arr = [];
    for (let i = 0; i < len; i++) {
        if (depth <= 1) {
            arr.push(randomPrimitive());
        } else {
            const r = Math.random();
            if (r < 0.4) arr.push(randomPrimitive());
            else if (r < 0.7) arr.push(randomNestedObject(depth - 1));
            else arr.push(randomArray(depth - 1));
        }
    }
    return arr;
}

function randomNestedObject(depth) {
    if (depth <= 0) return randomPrimitive();

    const propCount = randomInt(3, 5);
    const obj = {};
    const nestedKeys = [
        'value',
        'label',
        'code',
        'status',
        'count',
        'amount',
        'description',
        'channel',
        'category',
        'rating',
        'score',
        'timestamp',
        'flag',
        'level',
        'index',
        'name',
        'title',
        'ref',
        'mode',
        'kind',
        'tag',
        'unit',
        'source',
        'target',
    ];

    const usedKeys = new Set();
    for (let i = 0; i < propCount; i++) {
        let key;
        do {
            key = pick(nestedKeys);
        } while (usedKeys.has(key));
        usedKeys.add(key);

        const r = Math.random();
        if (depth <= 1 || r < 0.45) {
            obj[key] = randomPrimitive();
        } else if (r < 0.75) {
            obj[key] = randomNestedObject(depth - 1);
        } else {
            obj[key] = randomArray(depth - 1);
        }
    }
    return obj;
}

function randomComplexValue() {
    // Always return an object at the top level, depth up to 3
    return randomNestedObject(3);
}

// ── property name pools ──────────────────────────────────────────────

// 5 "slots" of varying property names — each slot has up to 10 variants
// Records pick one variant per slot, simulating slight naming deviations.
const VARYING_SLOTS = [
    // slot 0: address-like
    [
        'address',
        'addr',
        'location',
        'homeAddress',
        'mailingAddress',
        'postalAddress',
        'residence',
        'addressInfo',
        'addrDetail',
        'addressData',
    ],
    // slot 1: payment-like
    [
        'payment',
        'paymentInfo',
        'billing',
        'billingInfo',
        'paymentData',
        'paymentDetail',
        'payMethod',
        'transaction',
        'paymentRecord',
        'charge',
    ],
    // slot 2: preferences-like
    [
        'preferences',
        'prefs',
        'settings',
        'config',
        'options',
        'userPrefs',
        'userSettings',
        'prefData',
        'configData',
        'settingsInfo',
    ],
    // slot 3: metadata-like
    [
        'metadata',
        'meta',
        'metaInfo',
        'metaData',
        'extraInfo',
        'additionalInfo',
        'context',
        'contextData',
        'annotations',
        'tags',
    ],
    // slot 4: social / profile-like
    [
        'social',
        'socialLinks',
        'profile',
        'profileData',
        'socialMedia',
        'networks',
        'socialInfo',
        'accounts',
        'links',
        'connections',
    ],
];

// ── fixed property value generators ──────────────────────────────────

const firstNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank', 'Ivy', 'Jack'];
const domains = ['example.com', 'test.org', 'mail.io', 'demo.net', 'acme.co'];

function generateFixedProps(index) {
    const name = pick(firstNames);
    return {
        userId: `user_${String(index).padStart(5, '0')}`,
        email: `${name.toLowerCase()}${randomInt(1, 9999)}@${pick(domains)}`,
        age: randomInt(18, 85),
        isActive: randomBool(),
        createdAt: randomDate(),
    };
}

function generateBinaryData(index) {
    const bytes = Buffer.alloc(BINARY_BYTES, index % 256);
    if (bytes.length >= 4) {
        bytes.writeUInt32BE(index, 0);
    }
    return bytes.toString('base64');
}

// ── record generation ────────────────────────────────────────────────

function generateRecord(index) {
    const record = { id: `doc_${String(index).padStart(5, '0')}` };

    // Fixed primitive properties
    Object.assign(record, generateFixedProps(index));
    if (INCLUDE_BINARY_DATA) {
        record.binaryData = generateBinaryData(index);
    }

    // Varying complex properties
    for (const slot of VARYING_SLOTS) {
        const propName = pick(slot);
        record[propName] = randomComplexValue();
    }

    return record;
}

// ── main ─────────────────────────────────────────────────────────────

console.log(
    `Generating ${RECORD_COUNT} records${INCLUDE_BINARY_DATA ? ` with ${BINARY_BYTES} binary bytes each` : ''}…`,
);
const records = [];
for (let i = 0; i < RECORD_COUNT; i++) {
    records.push(generateRecord(i));
}

const json = JSON.stringify(records, null, 2);
writeFileSync(OUTPUT, json, 'utf-8');
console.log(`Done → ${OUTPUT}  (${(Buffer.byteLength(json) / 1024 / 1024).toFixed(1)} MiB)`);
