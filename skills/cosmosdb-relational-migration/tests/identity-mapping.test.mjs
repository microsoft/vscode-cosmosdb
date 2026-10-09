import assert from 'node:assert/strict';
import test from 'node:test';
import {
    identityModelHash,
    resolveItemId,
    validateIdentityManifest,
} from '../scripts/identity-mapping.mjs';

const entity = { name: 'Item', sourceTable: 'public.Items', idTemplate: 'item-{First}-{Second}', attributes: [
    { target: 'first', source: { column: 'First' } }, { target: 'second', source: { column: 'Second' } },
] };
const mapping = { encoding: 'typed-hex-v1' };

test('typed encoding distinguishes composite boundaries, types, case, Unicode and source namespace', () => {
    const inputs = [{ first: 'a/b', second: 'c' }, { first: 'a-b', second: 'c' }, { first: 'a', second: 'b-c' },
        { first: 'A', second: 'c' }, { first: '\u00e9', second: 'c' }, { first: 1, second: 'c' }, { first: '1', second: 'c' }];
    const ids = inputs.map(item => resolveItemId(entity, item, mapping));
    assert.equal(new Set(ids).size, inputs.length);
    assert(ids.every(id => /^[a-z0-9-]+$/u.test(id)));
    assert.deepEqual(inputs.map(item => resolveItemId(entity, item, mapping)), ids);
    assert.notEqual(resolveItemId({ ...entity, sourceTable: 'other.Items' }, inputs[0], mapping), ids[0]);
    assert.equal(resolveItemId(entity, { first: 'a/b', second: 'c' }, mapping), 'v1-s7075626c69632e4974656d73-s4974656d-s612f62-s63');
});

test('preserves safe legacy values, rejects ambiguous values and unsafe numeric identity', () => {
    assert.equal(resolveItemId(entity, { first: 1, second: 2 }), 'item-1-2');
    assert.throws(() => resolveItemId(entity, { first: 'a-b', second: 'c' }), /Ambiguous/);
    assert.throws(() => resolveItemId(entity, { first: Number.MAX_SAFE_INTEGER + 1, second: 1 }, mapping), /lossless/);
    assert.throws(() => resolveItemId(entity, { first: 'a'.repeat(1000), second: 'b' }, mapping), /byte limit/);
    assert.doesNotThrow(() => resolveItemId(entity, { first: '9007199254740993', second: '1' }, mapping));
});

test('UUID fallback validates the durable ID stored in the item', () => {
    const fallback = { ...entity, idTemplate: '{uuid}' };
    for (const id of [
        'c56a4180-65aa-42ec-a945-5fd21dec0538',
        '01890f47-4d2a-7cc1-98c4-dc0c0c07398f',
    ]) {
        assert.equal(resolveItemId(fallback, { id }), id);
    }
    assert.throws(() => resolveItemId(fallback, { id: 'invalid' }), /valid UUID persisted as the item id/);
    assert.throws(
        () => resolveItemId(fallback, { id: 'c56a4180-65aa-42ec-a945-5fd21dec0538' }, { encoding: 'legacy' }),
        /does not use.*identity mapping/u,
    );
});

test('rejects schema-conversion mappings and row assignments for generated UUID fallback', () => {
    const fallback = {
        ...entity,
        docType: 'item',
        idTemplate: '{uuid}',
    };
    const model = {
        version: 1,
        domain: 'all',
        databaseName: 'migration',
        capacityMode: 'serverless',
        containers: [{
            name: 'Items',
            partitionKeys: [{ path: '/pk' }],
            entities: [fallback],
            indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
        }],
    };
    const mapping = {
        containerName: 'Items',
        docType: fallback.docType,
        sourceTable: fallback.sourceTable,
        idTemplate: fallback.idTemplate,
        encoding: 'legacy',
        rule: 'peer-id-rule',
        sourceFields: ['first'],
        assignments: [{
            sourceValues: ['source-row-1'],
            id: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
        }],
    };
    const errors = validateIdentityManifest(model, {
        version: 1,
        modelSha256: identityModelHash(model),
        mappings: [mapping],
    });
    assert(errors.some(error => error.message === 'Unsupported identity mapping property.'));
    assert(
        errors.some(error =>
            error.message === 'Generated UUID fallback must not use a schema-conversion identity mapping.'
        ),
    );
});

test('enforces the service ID byte limit with or without an explicit mapping', () => {
    const single = { ...entity, idTemplate: 'item-{First}' };
    for (const identityMapping of [undefined, { encoding: 'legacy' }]) {
        for (const first of ['a'.repeat(1018), '\u00e9'.repeat(509)]) {
            const id = resolveItemId(single, { first }, identityMapping);
            assert.equal(Buffer.byteLength(id, 'utf8'), 1023);
            assert.throws(
                () => resolveItemId(single, { first: `${first}a` }, identityMapping),
                (error) => {
                    assert.match(error.message, /1023-byte limit \(1024 UTF-8 bytes\)/);
                    assert(!error.message.includes(first));
                    return true;
                },
            );
        }
    }
});

test('checks the final encoded ID including namespace and encoding expansion', () => {
    const single = { ...entity, idTemplate: 'item-{First}' };
    const overhead = Buffer.byteLength(resolveItemId(single, { first: '' }, mapping), 'utf8');
    const first = 'a'.repeat(Math.floor((1023 - overhead) / 2));
    const idBytes = Buffer.byteLength(resolveItemId(single, { first }, mapping), 'utf8');
    assert(idBytes >= 1022 && idBytes <= 1023);
    assert.throws(() => resolveItemId(single, { first: `${first}a` }, mapping), /1023-byte limit/);
    assert.throws(() => resolveItemId(single, { first: `${'a'.repeat(599)}/` }, mapping), /1023-byte limit/);
});

test('preserves native UUID values and rejects lossy Unicode input', () => {
    const native = { name: 'Native', sourceTable: 'ids', idTemplate: '{Guid}', attributes: [
        { target: 'id', isId: true, source: { column: 'Guid', type: 'uuid' } },
        { target: 'guid', source: { column: 'Guid', type: 'uuid' } },
    ] };
    const item = { guid: 'C56A4180-65AA-42EC-A945-5FD21DEC0538' };
    assert.equal(resolveItemId(native, item), item.guid);
    assert.throws(() => resolveItemId(native, item, mapping), /Native UUID/);
    assert.throws(() => resolveItemId(native, { guid: 'invalid' }), /UUID string/);
    assert.throws(() => resolveItemId(entity, { first: '\ud800', second: 'ok' }, mapping), /invalid Unicode/);
});

test('namespaces shared UUID source keys without changing source values or replay identity', () => {
    const item = { guid: 'C56A4180-65AA-42EC-A945-5FD21DEC0538' };
    for (const sourceType of ['uuid', 'GUID', 'UniqueIdentifier']) {
        const entities = ['Customer', 'CustomerProfile'].map(name => ({
            name,
            sourceTable: `dbo.${name}`,
            idTemplate: `${name[0].toLowerCase()}${name.slice(1)}-{Guid}`,
            attributes: [
                { target: 'id', isId: true, source: { column: 'Guid', type: sourceType } },
                { target: 'guid', source: { column: 'Guid', type: sourceType } },
            ],
        }));
        for (const identityMapping of [undefined, { encoding: 'legacy' }, mapping]) {
            const ids = entities.map(candidate => resolveItemId(candidate, item, identityMapping));
            assert.equal(new Set(ids).size, entities.length);
            assert.deepEqual(entities.map(candidate => resolveItemId(candidate, item, identityMapping)), ids);
            if (identityMapping?.encoding !== 'typed-hex-v1') {
                assert.deepEqual(ids, [`customer-${item.guid}`, `customerProfile-${item.guid}`]);
            }
            for (const candidate of entities) {
                assert.throws(() => resolveItemId(candidate, { guid: 'invalid' }, identityMapping), /UUID strings/);
            }
        }
        assert.equal(item.guid, 'C56A4180-65AA-42EC-A945-5FD21DEC0538');
    }
});

test('encodes composite UUID identities without treating a component as the complete identity', () => {
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    for (const [firstType, secondType, secondValue, changedSecond] of [
        ['uuid', 'uuid', second, first],
        ['GUID', 'UniqueIdentifier', second, first],
        ['uuid', 'int', 1, 2],
    ]) {
        const composite = { ...entity, attributes: [
            { target: 'id', isId: true, source: { column: 'First', type: firstType } },
            { target: 'first', source: { column: 'First', type: firstType } },
            { target: 'second', source: { column: 'Second', type: secondType } },
        ] };
        const items = [{ first, second: secondValue }, { first: second, second: secondValue }, { first, second: changedSecond }];
        const ids = items.map(item => resolveItemId(composite, item, mapping));
        assert.equal(new Set(ids).size, items.length);
        assert.deepEqual(items.map(item => resolveItemId(composite, item, mapping)), ids);
        composite.attributes[0].source = { column: 'Second', type: secondType };
        assert.deepEqual(items.map(item => resolveItemId(composite, item, mapping)), ids);
        assert.throws(() => resolveItemId(composite, items[0]), /Ambiguous composite identity/);
        const unambiguous = { ...composite, idTemplate: 'item-{First}_{Second}' };
        assert.equal(resolveItemId(unambiguous, items[0]), `item-${first}_${secondValue}`);
        for (const encoding of [undefined, mapping]) {
            for (const invalidUuid of ['invalid', 101]) {
                assert.throws(() => resolveItemId(unambiguous, { first: invalidUuid, second: secondValue }, encoding), /UUID strings/);
                if (secondType !== 'int') {
                    assert.throws(() => resolveItemId(unambiguous, { first, second: invalidUuid }, encoding), /UUID strings/);
                }
            }
        }
    }
});
