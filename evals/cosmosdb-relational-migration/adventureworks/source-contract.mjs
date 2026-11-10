/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    createSourceResolver,
    sourceIdentity,
} from '../../../skills/cosmosdb-relational-migration/scripts/validate-source-evidence.mjs';

const schema = JSON.parse(readFileSync(new URL('./schema-contract.json', import.meta.url), 'utf8'));
export const tableNames = Object.keys(schema).sort();
const identity = (table) => table.identity.map(({ name }) => name).join('.');

// Only the six aliases declared by this fixture; this is not a general SQL parser.
const aliases = {
    name: 'nvarchar(50)',
    namestyle: 'bit',
    phone: 'nvarchar(25)',
    flag: 'bit',
    accountnumber: 'nvarchar(15)',
    ordernumber: 'nvarchar(25)',
};

function consistentField(value, keys, normalize, label) {
    const entries = keys.filter((key) => Object.hasOwn(value, key)).map((key) => normalize(value[key]));
    for (const entry of entries.slice(1)) assert.deepEqual(entry, entries[0], `${label}: contradictory fields`);
    return entries[0];
}

function integer(value, label) {
    if (typeof value === 'string') value = value.trim();
    assert.ok(
        typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)),
        `${label}: expected an integer`,
    );
    const result = Number(value);
    assert.ok(Number.isSafeInteger(result) && result >= 0, `${label}: expected a non-negative integer`);
    return result;
}

function boolean(value, label) {
    if (typeof value === 'boolean') return value;
    assert.equal(typeof value, 'string', `${label}: explicit boolean evidence is required`);
    const text = value.trim().toLowerCase().replace(/\s+/g, ' ');
    if (['true', 'yes'].includes(text)) return true;
    if (['false', 'no'].includes(text)) return false;
    assert.fail(`${label}: invalid boolean ${JSON.stringify(value)}`);
}

function normalizeType(value, column, label) {
    assert.equal(typeof value, 'string', `${label}: type is required`);
    let text = value
        .replace(/[\[\]\s]/g, '')
        .toLowerCase()
        .replace(/^sys\./, '');
    text = aliases[text.replace(/^dbo\./, '')] ?? text;
    const match = /^([a-z]+)(?:\((max|\d+)(?:,(\d+))?\))?$/.exec(text);
    assert.ok(match, `${label}: unsupported type representation ${value}`);
    const base = { integer: 'int', numeric: 'decimal', dec: 'decimal' }[match[1]] ?? match[1];
    if (['nvarchar', 'varchar', 'varbinary'].includes(base)) {
        assert.equal(match[3], undefined, `${label}: unexpected second length parameter`);
        const normalizeLength = (length) => {
            if (typeof length === 'string' && length.trim().toLowerCase() === 'max') return 'max';
            const result = integer(length, `${label}.length`);
            assert.ok(result > 0, `${label}: length must be positive`);
            return result;
        };
        const declared = match[2] === undefined ? undefined : normalizeLength(match[2]);
        const recorded = consistentField(column, ['length', 'maxLength'], normalizeLength, `${label}.length`);
        if (declared !== undefined && recorded !== undefined)
            assert.equal(recorded, declared, `${label}: contradictory length`);
        const length = declared ?? recorded;
        assert.notEqual(length, undefined, `${label}: length is missing`);
        return `${base}(${length})`;
    }
    if (base === 'decimal') {
        const declaredPrecision = match[2] === undefined ? undefined : integer(match[2], `${label}.precision`);
        const declaredScale = declaredPrecision === undefined ? undefined : integer(match[3] ?? 0, `${label}.scale`);
        const precision =
            column.precision === undefined ? declaredPrecision : integer(column.precision, `${label}.precision`);
        const scale = column.scale === undefined ? declaredScale : integer(column.scale, `${label}.scale`);
        if (declaredPrecision !== undefined)
            assert.equal(precision, declaredPrecision, `${label}: contradictory precision`);
        if (declaredScale !== undefined) assert.equal(scale, declaredScale, `${label}: contradictory scale`);
        assert.ok(
            precision >= 1 && precision <= 38 && scale >= 0 && scale <= precision,
            `${label}: precision/scale are missing or invalid`,
        );
        return `decimal(${precision},${scale})`;
    }
    assert.equal(match[2], undefined, `${label}: unexpected type parameters`);
    if (base === 'money') {
        if (column.precision !== undefined)
            assert.equal(integer(column.precision, label), 19, `${label}: MONEY precision`);
        if (column.scale !== undefined) assert.equal(integer(column.scale, label), 4, `${label}: MONEY scale`);
    }
    return base;
}

function checkColumn(actual, expected, table) {
    const label = `${table}.${expected.name}`;
    const computedType =
        typeof actual.type === 'string' && /^(computed(?: expression| column)?|expression)$/i.test(actual.type.trim());
    if (expected.computed) {
        assert.ok(
            computedType ||
                actual.computed === true ||
                (typeof actual.computed === 'string' && actual.computed.trim()) ||
                (typeof actual.computedExpression === 'string' && actual.computedExpression.trim()) ||
                (typeof actual.computedSql === 'string' && actual.computedSql.trim()),
            `${label}: computed-column evidence is missing`,
        );
        if (!computedType) {
            assert.equal(
                normalizeType(actual.type, actual, label),
                normalizeType(expected.inferredType, {}, label),
                `${label}: computed mapped type`,
            );
        }
        if (actual.efType !== undefined) {
            assert.equal(
                normalizeType(actual.efType, {}, label),
                normalizeType(expected.inferredType, {}, label),
                `${label}: EF mapped type`,
            );
        }
    } else {
        assert.equal(
            normalizeType(actual.type, actual, label),
            normalizeType(expected.type, {}, label),
            `${label}: source type`,
        );
    }
    if (actual.resolvedType !== undefined) {
        assert.equal(
            normalizeType(actual.resolvedType, actual, label),
            normalizeType(expected.computed ? expected.inferredType : expected.type, {}, label),
            `${label}: resolved type`,
        );
    }
    const nullable = consistentField(
        actual,
        ['nullable', 'isNullable'],
        (value) => {
            if (typeof value === 'string') {
                const text = value.trim().toLowerCase().replace(/\s+/g, ' ');
                if (expected.computed && text === 'unknown') return 'unknown';
                if (text === 'null') return true;
                if (text === 'not null') return false;
            }
            return boolean(value, `${label}.nullable`);
        },
        `${label}.nullable`,
    );
    assert.notEqual(nullable, undefined, `${label}: nullability is missing`);
    if (expected.computed) assert.ok(nullable === 'unknown' || nullable === false, `${label}: computed nullability`);
    else assert.equal(nullable, expected.nullable, `${label}: nullability`);
}

function action(value, label) {
    assert.equal(typeof value, 'string', `${label}: action is missing`);
    const normalized = value
        .trim()
        .toUpperCase()
        .replaceAll('_', ' ')
        .replace(/\s+/g, ' ')
        .replace(/ \((?:IMPLICIT|DEFAULT|INFERRED)\)$/, '');
    assert.ok(
        ['NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT', 'UNKNOWN'].includes(normalized),
        `${label}: invalid action`,
    );
    return normalized;
}

function keyColumns(index, label) {
    const normalize = (columns) => {
        assert.ok(Array.isArray(columns) && columns.length, `${label}: index columns are missing`);
        return columns.map((column) => {
            const name =
                typeof column === 'string'
                    ? column
                    : consistentField(column, ['name', 'column'], (value) => value, label);
            assert.equal(typeof name, 'string', `${label}: invalid index column`);
            if (/^[["`]/.test(name)) {
                const parts = sourceIdentity(name, 'tsql');
                assert.equal(parts.length, 1, `${label}: index columns must be unqualified`);
                return parts[0];
            }
            return name;
        });
    };
    const columns = consistentField(index, ['columns', 'keys', 'keyColumns'], normalize, label);
    assert.ok(columns, `${label}: index columns are missing`);
    return columns;
}

function checkIndexes(inventory, resolve, source) {
    const entries = [];
    const collect = (container, owner) => {
        for (const field of ['indexes', 'uniqueConstraints']) {
            if (container[field] === undefined) continue;
            assert.ok(Array.isArray(container[field]), `${owner ?? 'Source'}: ${field} must be an array`);
            for (const value of container[field]) {
                const table = value.table === undefined ? owner : identity(resolve(value.table));
                assert.ok(table, 'Source index owner is missing');
                if (owner) assert.equal(table, owner, `${owner}: index owner`);
                let index = value;
                if (field === 'uniqueConstraints') {
                    for (const flag of ['unique', 'isUnique']) {
                        if (value[flag] !== undefined)
                            assert.equal(
                                boolean(value[flag], field),
                                true,
                                `${table}: contradictory unique constraint`,
                            );
                    }
                    index = { ...value, unique: true };
                }
                entries.push({ index, table });
            }
        }
    };
    collect(inventory);
    for (const table of inventory.tables) collect(table, identity(table));
    const seen = new Set();
    for (const { index, table } of entries) {
        const label = `${table}.${index.name ?? '<unnamed index>'}`;
        const columns = keyColumns(index, label);
        const expected = schema[table].indexes.find(
            (entry) => JSON.stringify(entry.columns) === JSON.stringify(columns),
        );
        assert.ok(expected, `${label}: unexpected index key columns ${JSON.stringify(columns)}`);
        const key = `${table}/${expected.name}`;
        assert.ok(!seen.has(key), `${label}: duplicate index evidence`);
        seen.add(key);
        if (source === 'supplied') assert.equal(index.name, expected.name, `${label}: source index name`);
        const unique = consistentField(
            index,
            ['unique', 'isUnique'],
            (value) => boolean(value, `${label}.unique`),
            label,
        );
        assert.equal(unique, expected.unique, `${label}: uniqueness`);
        for (const field of ['filter', 'filterPredicate']) {
            assert.ok(
                index[field] === undefined || index[field] === null || index[field] === '',
                `${label}: unexpected filtered index`,
            );
        }
        if (index.includedColumns !== undefined)
            assert.deepEqual(index.includedColumns, [], `${label}: unexpected included columns`);
    }
    for (const [table, definition] of Object.entries(schema)) {
        for (const index of definition.indexes) {
            if (source === 'inferred' && index.inferredOptional) continue;
            assert.ok(seen.has(`${table}/${index.name}`), `${table}.${index.name}: index evidence is missing`);
        }
    }
}

export function checkAdventureWorksInventory(inventory, { source = 'supplied' } = {}) {
    assert.ok(['supplied', 'inferred'].includes(source), 'Unknown source-evidence mode');
    assert.deepEqual(
        inventory.tables.map(identity).sort(),
        tableNames,
        'Source table inventory differs from the fixture',
    );
    const resolve = createSourceResolver(inventory);
    for (const [name, expected] of Object.entries(schema)) {
        const actual = resolve(name);
        assert.deepEqual(
            actual.columns.map((column) => column.name).sort(),
            expected.columns.map((column) => column.name).sort(),
            `${name} columns`,
        );
        for (const column of expected.columns)
            checkColumn(
                actual.columns.find(({ name }) => name === column.name),
                column,
                name,
            );
        assert.deepEqual(actual.primaryKey, expected.primaryKey, `${name} primary-key order`);
        const endpoints = (key) =>
            JSON.stringify({
                columns: key.columns,
                referencedTable: identity(resolve(key.referencedTable)),
                referencedColumns: key.referencedColumns,
            });
        assert.deepEqual(
            actual.foreignKeys.map(endpoints).sort(),
            expected.foreignKeys.map(endpoints).sort(),
            `${name} foreign keys`,
        );
        for (const key of actual.foreignKeys) {
            const expectedKey = expected.foreignKeys.find((entry) => endpoints(entry) === endpoints(key));
            const label = `${name} FK (${key.columns.join(', ')})`;
            const onDelete = consistentField(key, ['onDelete', 'deleteAction'], (value) => action(value, label), label);
            if (source === 'supplied' || (onDelete !== undefined && onDelete !== 'UNKNOWN')) {
                assert.equal(onDelete, expectedKey.onDelete, `${label}: delete action`);
            }
            const onUpdate = consistentField(key, ['onUpdate', 'updateAction'], (value) => action(value, label), label);
            if (onUpdate !== undefined && !(source === 'inferred' && onUpdate === 'UNKNOWN')) {
                assert.equal(onUpdate, 'NO ACTION', `${label}: update action`);
            }
        }
    }
    checkIndexes(inventory, resolve, source);
}
