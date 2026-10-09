import assert from 'node:assert/strict';
import test from 'node:test';
import { identityModelHash, resolveItemId } from '../scripts/identity-mapping.mjs';
import { validateSampleData } from '../scripts/validate-sample-data.mjs';

const targetTypeCases = [
    ['string', 'value', [null, 12, true, {}, []]],
    ['number', 1.25, [null, '1.25', true, {}, [], NaN, Infinity, -Infinity]],
    ['integer', 12, [null, '12', 1.25, true, {}, [], NaN, Infinity]],
    ['boolean', false, [null, 'false', 0, {}, []]],
    ['object', { nested: [null, true, 'value'] }, [null, 'value', 12, true, []]],
    ['array', [null, { nested: true }], [null, 'value', 12, true, {}]],
    ['null', null, ['null', 0, false, {}, []]],
];

function model() {
    return {
        version: 1,
        domain: 'all',
        databaseName: 'migration-db',
        capacityMode: 'serverless',
        containers: [
            {
                name: 'Orders',
                partitionKeys: [{ path: '/tenantId' }],
                entities: [
                    {
                        name: 'Order',
                        docType: 'order',
                        sourceTable: 'dbo.Orders',
                        idTemplate: 'order-{OrderID}',
                        attributes: [
                            {
                                target: 'id',
                                source: { table: 'Orders', column: 'OrderID', type: 'int' },
                                type: 'string',
                                isId: true,
                            },
                            {
                                target: 'orderId',
                                source: { table: 'Orders', column: 'OrderID', type: 'int' },
                                type: 'integer',
                            },
                            {
                                target: 'tenantId',
                                source: { table: 'Orders', column: 'TenantID', type: 'int' },
                                type: 'string',
                                isPartitionKey: true,
                            },
                            {
                                target: 'paid',
                                source: { table: 'Orders', column: 'Paid', type: 'bit' },
                                type: 'boolean',
                            },
                        ],
                    },
                    {
                        name: 'OrderLine',
                        docType: 'orderLine',
                        sourceTable: 'dbo.OrderLines',
                        attributes: [
                            {
                                target: 'sku',
                                source: { table: 'OrderLines', column: 'Sku', type: 'varchar' },
                                type: 'string',
                            },
                        ],
                        isEmbeddedOnly: true,
                    },
                ],
                indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] },
            },
        ],
    };
}

function samples() {
    return {
        sampleData: [
            {
                containerName: 'Orders',
                items: [{ id: 'order-101', docType: 'order', orderId: 101, tenantId: 'tenant-1', paid: true }],
            },
        ],
    };
}

function referenceFixture() {
    const definition = model();
    const order = definition.containers[0].entities[0];
    order.attributes.push({
        target: 'customerId',
        source: { table: 'Orders', column: 'CustomerID', type: 'int' },
        type: 'integer',
    });
    order.relationships = [{
        targetEntity: 'Customer',
        sourceFK: { table: 'Orders', column: 'CustomerID' },
        type: 'one-to-one',
        strategy: 'reference',
    }];
    definition.containers[0].entities.push({
        name: 'Customer',
        docType: 'customer',
        sourceTable: 'dbo.Customers',
        idTemplate: 'customer-{CustomerID}',
        attributes: [
            {
                target: 'id',
                source: { table: 'Customers', column: 'CustomerID', type: 'int' },
                type: 'string',
                isId: true,
            },
            {
                target: 'customerId',
                source: { table: 'Customers', column: 'CustomerID', type: 'int' },
                type: 'integer',
            },
            {
                target: 'tenantId',
                source: { table: 'Customers', column: 'TenantID', type: 'varchar' },
                type: 'string',
                isPartitionKey: true,
            },
        ],
    });
    const data = samples();
    Object.assign(data.sampleData[0].items[0], { customerId: 7 });
    data.sampleData[0].items.push({
        id: 'customer-7',
        docType: 'customer',
        customerId: 7,
        tenantId: 'tenant-1',
    });
    const inventory = {
        dialect: 'tsql',
        errors: [],
        tables: [
            {
                name: 'dbo.Orders',
                identity: [{ name: 'dbo' }, { name: 'Orders' }],
                columns: [{ name: 'OrderID' }, { name: 'TenantID' }, { name: 'CustomerID' }],
                foreignKeys: [{
                    columns: ['CustomerID'],
                    referencedTable: 'dbo.Customers',
                    referencedColumns: ['CustomerID'],
                }],
            },
            {
                name: 'dbo.Customers',
                identity: [{ name: 'dbo' }, { name: 'Customers' }],
                columns: [{ name: 'CustomerID' }, { name: 'TenantID' }],
                foreignKeys: [],
            },
        ],
    };
    return { definition, data, inventory };
}

test('accepts model-aligned sample data', () => {
    assert.deepEqual(validateSampleData(model(), samples()), []);
});

test('enforces composite unique keys within the full partition tuple with case-sensitive values', () => {
    const definition = model();
    const container = definition.containers[0];
    container.partitionKeys.push({ path: '/paid' });
    container.entities[0].attributes.find(attribute => attribute.target === 'paid').isPartitionKey = true;
    container.uniqueKeyPolicy = { uniqueKeys: [{ paths: ['/profile/email', '/docType'] }] };
    const data = samples();
    const first = data.sampleData[0].items[0];
    first.profile = { email: 'name@example.com' };
    const second = { ...structuredClone(first), id: 'order-102', orderId: 102 };
    data.sampleData[0].items.push(second);
    assert(validateSampleData(definition, data).some(error => error.message.includes('duplicates unique-key')));
    second.paid = false;
    assert.deepEqual(validateSampleData(definition, data), []);
    second.paid = true;
    second.profile.email = 'Name@example.com';
    assert.deepEqual(validateSampleData(definition, data), []);
    second.profile.email = {};
    assert(validateSampleData(definition, data).some(error => error.message.includes('scalar or null')));
});

test('treats missing unique paths as null and honors quoted property names', () => {
    const definition = model();
    definition.containers[0].uniqueKeyPolicy = { uniqueKeys: [{ paths: ['/profile/"email/address"'] }] };
    const data = samples();
    const first = data.sampleData[0].items[0];
    const second = { ...first, id: 'order-102', orderId: 102, profile: { 'email/address': null } };
    data.sampleData[0].items.push(second);
    assert(validateSampleData(definition, data).some(error => error.message.includes('duplicates unique-key')));
    second.profile['email/address'] = 'one@example.com';
    assert.deepEqual(validateSampleData(definition, data), []);
    first.profile = { 'email/address': 'one@example.com' };
    assert(validateSampleData(definition, data).some(error => error.message.includes('duplicates unique-key')));
});

test('does not implicitly isolate unique keys by docType', () => {
    const definition = model();
    const container = definition.containers[0];
    const other = structuredClone(container.entities[0]);
    Object.assign(other, {
        name: 'OtherOrder', docType: 'otherOrder', sourceTable: 'dbo.OtherOrders', idTemplate: 'otherOrder-{OrderID}',
    });
    container.entities.push(other);
    container.uniqueKeyPolicy = { uniqueKeys: [{ paths: ['/email'] }] };
    const data = samples();
    const first = data.sampleData[0].items[0];
    data.sampleData[0].items.push({ ...first, id: 'otherOrder-102', orderId: 102, docType: 'otherOrder' });
    assert(validateSampleData(definition, data).some(error => error.message.includes('duplicates unique-key')));
    container.uniqueKeyPolicy.uniqueKeys[0].paths.push('/docType');
    assert.deepEqual(validateSampleData(definition, data), []);
});

test('checks every target type without coercion and distinguishes missing fields from null', () => {
    for (const [type, value, invalidValues] of targetTypeCases) {
        const definition = model();
        definition.containers[0].entities[0].attributes.push({
            target: 'value', source: { table: 'Orders', column: 'Value', type: 'sql_variant' }, type,
        });
        const data = samples();
        const item = data.sampleData[0].items[0];
        item.value = value;
        assert.deepEqual(validateSampleData(definition, data), [], type);
        for (const invalid of [...invalidValues, undefined]) {
            item.value = invalid;
            const errors = validateSampleData(definition, data);
            assert(errors.some(error => error.path.endsWith('.value') && error.message === `must have JSON type ${type}`), type);
        }
        delete item.value;
        assert(validateSampleData(definition, data).some(error => error.path.endsWith('.value') && error.message.includes('required')), type);
    }
});

test('rejects unsupported target types before sample values can bypass validation', () => {
    for (const entityIndex of [0, 1]) {
        for (const type of ['decimal', 'bigint', 'uuid', 'datetime', 'String', 'string|null', ['string', 'null'], null]) {
            const definition = model();
            definition.containers[0].entities[entityIndex].attributes.push({
                target: 'value', source: { table: 'Orders', column: 'Value', type: 'decimal(38,18)' }, type,
            });
            const data = samples();
            data.sampleData[0].items[0].value = { not: 'a decimal' };
            const errors = validateSampleData(definition, data);
            assert(errors.some(error => error.path.startsWith('$.model.') && error.path.endsWith('.type') && error.message.includes('target JSON type')));
        }
    }
});

test('preserves precision-sensitive source values as explicit target strings', () => {
    const definition = model();
    const fields = [
        ['externalValue', 'bigint', '9007199254740993'],
        ['amount', 'decimal(38,18)', '99999999999999999999.123456789012345678'],
    ];
    const data = samples();
    const item = data.sampleData[0].items[0];
    for (const [target, sourceType, value] of fields) {
        definition.containers[0].entities[0].attributes.push({
            target, source: { table: 'Orders', column: target, type: sourceType }, type: 'string',
        });
        item[target] = value;
    }
    const before = structuredClone(data);
    assert.deepEqual(validateSampleData(definition, data), []);
    assert.deepEqual(data, before);
    assert.deepEqual(JSON.parse(JSON.stringify(data)), before);
    for (const [target, , value] of fields) {
        item[target] = Number(value);
        assert(validateSampleData(definition, data).some(error => error.path.endsWith(`.${target}`) && error.message === 'must have JSON type string'));
        item[target] = value;
    }
});

test('explicit null support does not relax identity or partition-key rules', () => {
    for (const target of ['id', 'tenantId']) {
        const definition = model();
        definition.containers[0].entities[0].attributes.find(attribute => attribute.target === target).type = 'null';
        const data = samples();
        data.sampleData[0].items[0][target] = null;
        assert(validateSampleData(definition, data).length > 0, target);
    }
});

test('requires every reference sample to resolve to the intended target entity', () => {
    const { definition, data, inventory } = referenceFixture();
    assert.deepEqual(validateSampleData(definition, data, undefined, inventory), []);

    data.sampleData[0].items[0].customerId = 999;
    const errors = validateSampleData(definition, data, undefined, inventory);
    assert(
        errors.some(error =>
            error.path === '$.sampleData[0].items[0]' &&
            error.message.includes('no customer sample matching relationship Order -> Customer')
        ),
    );
});

test('does not resolve standalone references against embedded snapshots', () => {
    const { definition, data, inventory } = referenceFixture();
    const order = definition.containers[0].entities[0];
    order.relationships.push({
        ...order.relationships[0],
        strategy: 'embed',
        targetProperty: 'customerSnapshot',
    });
    const [orderSample, customerSample] = data.sampleData[0].items;
    orderSample.customerSnapshot = structuredClone(customerSample);
    assert.deepEqual(validateSampleData(definition, data, undefined, inventory), []);

    Object.assign(customerSample, { id: 'customer-8', customerId: 8 });
    const original = structuredClone(data);
    assert.deepEqual(validateSampleData(definition, data, undefined, inventory), [
        {
            path: '$.sampleData[0].items[0]',
            message: 'has no customer sample matching relationship Order -> Customer',
        },
    ]);
    assert.deepEqual(data, original);

    data.sampleData[0].items.push(structuredClone(orderSample.customerSnapshot));
    assert.deepEqual(validateSampleData(definition, data, undefined, inventory), []);
    orderSample.customerSnapshot.customerId = 999;
    assert.deepEqual(validateSampleData(definition, data, undefined, inventory), [
        {
            path: '$.sampleData[0].items[0].customerSnapshot',
            message: 'does not match relationship Order -> Customer',
        },
    ]);
});

test('matches composite references as complete ordered key tuples', () => {
    const { definition, data, inventory } = referenceFixture();
    inventory.tables[0].foreignKeys[0] = {
        columns: ['TenantID', 'CustomerID'],
        referencedTable: 'dbo.Customers',
        referencedColumns: ['TenantID', 'CustomerID'],
    };
    data.sampleData[0].items.push({
        id: 'customer-8',
        docType: 'customer',
        customerId: 8,
        tenantId: 'tenant-2',
    });
    assert.deepEqual(validateSampleData(definition, data, undefined, inventory), []);

    data.sampleData[0].items[0].customerId = 8;
    const errors = validateSampleData(definition, data, undefined, inventory);
    assert(errors.some(error => error.message.includes('no customer sample matching relationship')));
});

test('validates embedded placement, child fields, and foreign-key consistency', () => {
    const definition = model();
    const [order, orderLine] = definition.containers[0].entities;
    orderLine.attributes.unshift(
        {
            target: 'lineId',
            source: { table: 'OrderLines', column: 'LineID', type: 'int' },
            type: 'integer',
        },
        {
            target: 'orderId',
            source: { table: 'OrderLines', column: 'OrderID', type: 'int' },
            type: 'integer',
        },
    );
    order.relationships = [{
        targetEntity: 'OrderLine',
        sourceFK: { table: 'OrderLines', column: 'OrderID' },
        type: 'one-to-many',
        strategy: 'embed',
        targetProperty: 'lines',
    }];
    const data = samples();
    data.sampleData[0].items[0].lines = [{ lineId: 1, orderId: 101, sku: 'SKU-1' }];
    const inventory = {
        dialect: 'tsql',
        errors: [],
        tables: [
            {
                name: 'dbo.Orders',
                identity: [{ name: 'dbo' }, { name: 'Orders' }],
                columns: [{ name: 'OrderID' }, { name: 'TenantID' }, { name: 'Paid' }],
                foreignKeys: [],
            },
            {
                name: 'dbo.OrderLines',
                identity: [{ name: 'dbo' }, { name: 'OrderLines' }],
                columns: [{ name: 'LineID' }, { name: 'OrderID' }, { name: 'Sku' }],
                foreignKeys: [{
                    columns: ['OrderID'],
                    referencedTable: 'dbo.Orders',
                    referencedColumns: ['OrderID'],
                }],
            },
        ],
    };
    assert.deepEqual(validateSampleData(definition, data, undefined, inventory), []);

    orderLine.attributes.push(
        { target: 'productId', source: { table: 'OrderLines', column: 'ProductID', type: 'int' }, type: 'integer' },
        { target: 'product', source: { table: '(generated)', column: 'Product', type: 'object' }, type: 'object' },
    );
    orderLine.relationships = [{
        targetEntity: 'Product',
        sourceFK: { table: 'OrderLines', column: 'ProductID' },
        type: 'one-to-one',
        strategy: 'embed',
        targetProperty: 'product',
    }];
    definition.containers[0].entities.unshift({
        name: 'Product',
        docType: 'product',
        sourceTable: 'dbo.Products',
        isEmbeddedOnly: true,
        attributes: [
            { target: 'productId', source: { table: 'Products', column: 'ProductID', type: 'int' }, type: 'integer' },
            { target: 'name', source: { table: 'Products', column: 'Name', type: 'nvarchar' }, type: 'string' },
        ],
    });
    inventory.tables[1].columns.push({ name: 'ProductID' });
    inventory.tables[1].foreignKeys.push({
        columns: ['ProductID'],
        referencedTable: 'dbo.Products',
        referencedColumns: ['ProductID'],
    });
    inventory.tables.push({
        name: 'dbo.Products',
        identity: [{ name: 'dbo' }, { name: 'Products' }],
        columns: [{ name: 'ProductID' }, { name: 'Name' }],
        foreignKeys: [],
    });
    const nestedLine = data.sampleData[0].items[0].lines[0];
    Object.assign(nestedLine, { productId: 7, product: { productId: 7, name: 'Nested product' } });
    const originalNestedData = structuredClone(data);
    assert.deepEqual(validateSampleData(definition, data, undefined, inventory), []);
    assert.deepEqual(data, originalNestedData);
    for (const invalid of [undefined, 7]) {
        nestedLine.product.name = invalid;
        assert(validateSampleData(definition, data, undefined, inventory).some(error =>
            error.path === '$.sampleData[0].items[0].lines[0].product.name'
        ));
    }
    nestedLine.product.name = 'Nested product';
    nestedLine.product.productId = 8;
    assert(validateSampleData(definition, data, undefined, inventory).some(error =>
        error.path === '$.sampleData[0].items[0].lines[0].product' &&
        error.message === 'does not match relationship OrderLine -> Product'
    ));
    nestedLine.product.productId = 7;

    for (const [type, value, invalidValues] of targetTypeCases) {
        orderLine.attributes.push({ target: 'value', source: { table: 'OrderLines', column: 'Value', type: 'sql_variant' }, type });
        const child = data.sampleData[0].items[0].lines[0];
        child.value = value;
        assert.deepEqual(validateSampleData(definition, data, undefined, inventory), [], type);
        for (const invalid of [...invalidValues, undefined]) {
            child.value = invalid;
            assert(validateSampleData(definition, data, undefined, inventory).some(error =>
                error.path.endsWith('.lines[0].value') && error.message === `must have JSON type ${type}`
            ), type);
        }
        delete child.value;
        assert(validateSampleData(definition, data, undefined, inventory).some(error =>
            error.path.endsWith('.lines[0].value') && error.message.includes('required')
        ), type);
        orderLine.attributes.pop();
    }
    data.sampleData[0].items[0].lines[0].orderId = 999;
    assert(
        validateSampleData(definition, data, undefined, inventory)
            .some(error => error.message === 'does not match relationship Order -> OrderLine'),
    );
    delete data.sampleData[0].items[0].lines;
    assert(
        validateSampleData(definition, data, undefined, inventory)
            .some(error => error.message === 'must include embedded samples for Order.lines'),
    );
});

test('enforces ID UTF-8 byte boundaries without an identity manifest', () => {
    const definition = model();
    definition.containers[0].entities[0].attributes.find((attribute) => attribute.target === 'orderId').type = 'string';
    for (const orderId of ['a'.repeat(1017), `${'\u00e9'.repeat(508)}a`]) {
        const data = samples();
        const item = data.sampleData[0].items[0];
        Object.assign(item, { orderId, id: `order-${orderId}` });
        assert.deepEqual(validateSampleData(definition, data), []);
        item.orderId += 'a';
        item.id += 'a';
        assert.deepEqual(validateSampleData(definition, data), [
            {
                path: '$.sampleData[0].items[0].id',
                message:
                    'Resolved ID exceeds the 1023-byte limit (1024 UTF-8 bytes); choose a bounded mapping without truncation.',
            },
        ]);
    }
});

test('checks partition-key UTF-8 bytes rather than character count or JSON escaping', () => {
    for (const tenantId of ['a'.repeat(2048), '\u00e9'.repeat(1024), '\u{1f600}'.repeat(512), '"'.repeat(2048)]) {
        const data = samples();
        data.sampleData[0].items[0].tenantId = tenantId;
        assert.deepEqual(validateSampleData(model(), data), []);
        data.sampleData[0].items[0].tenantId += 'a';
        const original = structuredClone(data);
        assert.deepEqual(validateSampleData(model(), data), [
            {
                path: '$.sampleData[0].items[0].tenantId',
                message: 'exceeds the 2048-byte partition-key limit (2049 UTF-8 bytes)',
            },
        ]);
        assert.deepEqual(data, original);
    }
});

test('validates each hierarchical partition-key component independently', () => {
    for (const levelCount of [2, 3]) {
        const definition = model();
        const container = definition.containers[0];
        const data = samples();
        const item = data.sampleData[0].items[0];
        const targets = ['tenantId', 'customerId', 'sessionId'].slice(0, levelCount);
        container.partitionKeys = targets.map((target) => ({ path: `/${target}` }));
        for (const target of targets.slice(1)) {
            container.entities[0].attributes.push({
                target,
                source: { table: 'Orders', column: target, type: 'varchar' },
                type: 'string',
                isPartitionKey: true,
            });
        }
        for (const target of targets) item[target] = 'a'.repeat(2048);
        assert.deepEqual(validateSampleData(definition, data), []);
        for (const target of targets) {
            item[target] += 'a';
            assert.deepEqual(validateSampleData(definition, data), [
                {
                    path: `$.sampleData[0].items[0].${target}`,
                    message: 'exceeds the 2048-byte partition-key limit (2049 UTF-8 bytes)',
                },
            ]);
            item[target] = item[target].slice(0, -1);
        }
    }
});

test('preserves numeric and boolean partition-key values', () => {
    for (const tenantId of [42, true, false]) {
        const definition = model();
        definition.containers[0].entities[0].attributes.find((attribute) => attribute.target === 'tenantId').type =
            typeof tenantId;
        const data = samples();
        data.sampleData[0].items[0].tenantId = tenantId;
        assert.deepEqual(validateSampleData(definition, data), []);
    }
});

test('treats a generated UUID sample id as durable provisioning data', () => {
    const definition = model();
    const entity = definition.containers[0].entities[0];
    entity.idTemplate = '{uuid}';
    entity.attributes.find(attribute => attribute.isId).source = {
        table: '(generated)',
        column: '(uuid)',
        type: 'uuid',
    };
    const data = samples();
    data.sampleData[0].items[0].id = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
    const original = structuredClone(data);

    assert.deepEqual(validateSampleData(definition, data), []);
    assert.deepEqual(validateSampleData(definition, data), []);
    assert.deepEqual(data, original);

    data.sampleData[0].items[0].id = 'not-a-uuid';
    assert(
        validateSampleData(definition, data).some(error =>
            error.path.endsWith('.id') && error.message.includes('valid UUID persisted as the item id')
        ),
    );
});

test('uses an explicitly selected identity manifest and rejects stale or unsupported mappings', () => {
    const definition = model();
    const entity = definition.containers[0].entities[0];
    entity.attributes.find(attribute => attribute.target === 'orderId').type = 'string';
    const mapping = { containerName: 'Orders', docType: 'order', sourceTable: entity.sourceTable,
        idTemplate: entity.idTemplate, encoding: 'typed-hex-v1', rule: 'peer-id-rule' };
    const manifest = { version: 1, modelSha256: identityModelHash(definition), mappings: [mapping] };
    const data = samples();
    data.sampleData[0].items[0].orderId = 'a/b';
    data.sampleData[0].items[0].id = resolveItemId(entity, data.sampleData[0].items[0], mapping);
    assert.deepEqual(validateSampleData(definition, data, manifest), []);
    assert(validateSampleData(definition, data).length > 0);
    for (const maxIdBytes of [512, 1023, 2048]) {
        manifest.mappings = [{ ...mapping, maxIdBytes }];
        assert.deepEqual(validateSampleData(definition, data, manifest), [
            {
                path: '$.identityMapping',
                message: 'Unsupported identity mapping property.',
            },
        ]);
    }
    manifest.mappings = [mapping];
    manifest.modelSha256 = 'stale';
    assert(validateSampleData(definition, data, manifest).some(error => error.path === '$.identityMapping'));
    manifest.modelSha256 = identityModelHash(definition);
    manifest.mappings = [null];
    assert(validateSampleData(definition, data, manifest).some(error => /objects/.test(error.message)));
});

test('validates composite UUID models, manifests and samples with either ID source component', () => {
    for (const secondType of ['uuid', 'int']) {
        const definition = model();
        const entity = definition.containers[0].entities[0];
        entity.idTemplate = 'order-{OrderID}-{LineID}';
        const naturalKey = entity.attributes.find(attribute => attribute.target === 'orderId');
        naturalKey.source.type = 'uuid';
        naturalKey.type = 'string';
        const secondKey = { target: 'lineId', source: { table: 'Orders', column: 'LineID', type: secondType }, type: secondType === 'uuid' ? 'string' : 'number' };
        entity.attributes.push(secondKey);
        const mapping = { containerName: 'Orders', docType: 'order', sourceTable: entity.sourceTable,
            idTemplate: entity.idTemplate, encoding: 'typed-hex-v1', rule: 'peer-id-rule' };
        const data = samples();
        Object.assign(data.sampleData[0].items[0], {
            orderId: 'C56A4180-65AA-42EC-A945-5FD21DEC0538',
            lineId: secondType === 'uuid' ? '11111111-1111-4111-8111-111111111111' : 1,
        });
        data.sampleData[0].items[0].id = resolveItemId(entity, data.sampleData[0].items[0], mapping);
        for (const keyAttribute of [naturalKey, secondKey]) {
            entity.attributes.find(attribute => attribute.isId).source = { ...keyAttribute.source };
            const manifest = { version: 1, modelSha256: identityModelHash(definition), mappings: [mapping] };
            assert.deepEqual(validateSampleData(definition, data, manifest), []);
            assert(validateSampleData(definition, data).some(error => /Ambiguous composite identity/.test(error.message)));
        }
    }
});

test('validates namespaced UUID models and manifests for co-located document types', () => {
    const definition = model();
    const container = definition.containers[0];
    const order = container.entities[0];
    order.idTemplate = '{OrderID}';
    order.attributes.find(attribute => attribute.isId).source.type = 'uuid';
    const naturalKey = order.attributes.find(attribute => attribute.target === 'orderId');
    naturalKey.source.type = 'uuid';
    naturalKey.type = 'string';
    const profile = structuredClone(order);
    profile.name = 'OrderProfile';
    profile.docType = 'orderProfile';
    profile.sourceTable = 'dbo.OrderProfiles';
    for (const attribute of profile.attributes) attribute.source.table = 'OrderProfiles';
    container.entities.push(profile);

    const data = samples();
    const nativeId = 'C56A4180-65AA-42EC-A945-5FD21DEC0538';
    const item = data.sampleData[0].items[0];
    Object.assign(item, { orderId: nativeId, id: nativeId });
    data.sampleData[0].items.push({ ...item, docType: profile.docType });
    assert(
        validateSampleData(definition, data).some(error => error.message.includes('same logical partition')),
    );

    order.idTemplate = 'order-{OrderID}';
    profile.idTemplate = 'orderProfile-{OrderID}';
    for (const encoding of ['legacy', 'typed-hex-v1']) {
        const mappings = [order, profile].map(entity => ({
            containerName: container.name,
            docType: entity.docType,
            sourceTable: entity.sourceTable,
            idTemplate: entity.idTemplate,
            encoding,
            rule: 'peer-id-rule',
        }));
        const manifest = { version: 1, modelSha256: identityModelHash(definition), mappings };
        for (const [index, entity] of [order, profile].entries()) {
            const sample = data.sampleData[0].items[index];
            sample.id = resolveItemId(entity, sample, mappings[index]);
            assert.equal(sample.orderId, nativeId);
        }
        assert.notEqual(data.sampleData[0].items[0].id, data.sampleData[0].items[1].id);
        assert.deepEqual(validateSampleData(definition, data, manifest), []);
        if (encoding === 'legacy') assert.deepEqual(validateSampleData(definition, data), []);
    }
});

test('preserves direct single-UUID samples and rejects encoded UUID manifests', () => {
    for (const sourceType of ['uuid', 'GUID', 'UniqueIdentifier']) {
        const definition = model();
        const entity = definition.containers[0].entities[0];
        entity.idTemplate = '{OrderID}';
        entity.attributes.find(attribute => attribute.isId).source.type = sourceType;
        const naturalKey = entity.attributes.find(attribute => attribute.target === 'orderId');
        naturalKey.source.type = sourceType;
        naturalKey.type = 'string';
        const data = samples();
        const nativeId = 'C56A4180-65AA-42EC-A945-5FD21DEC0538';
        Object.assign(data.sampleData[0].items[0], { orderId: nativeId, id: nativeId });
        const mapping = { containerName: 'Orders', docType: 'order', sourceTable: entity.sourceTable,
            idTemplate: entity.idTemplate, encoding: 'legacy', rule: 'peer-id-rule' };
        const manifest = { version: 1, modelSha256: identityModelHash(definition), mappings: [mapping] };
        assert.deepEqual(validateSampleData(definition, data), []);
        assert.deepEqual(validateSampleData(definition, data, manifest), []);
        assert.equal(resolveItemId(entity, data.sampleData[0].items[0], mapping), nativeId);
        mapping.encoding = 'typed-hex-v1';
        assert(validateSampleData(definition, data, manifest).some(error => /Native UUID identity must retain direct source-value encoding/.test(error.message)));
    }
});

test('requires exact container and standalone docType coverage', () => {
    const data = samples();
    data.sampleData[0].containerName = 'Unknown';
    const errors = validateSampleData(model(), data);
    assert(errors.some((error) => error.message.includes('does not exist in the canonical model')));
    assert(errors.some((error) => error.message === 'missing container Orders'));

    const embedded = samples();
    embedded.sampleData[0].items[0].docType = 'orderLine';
    assert(
        validateSampleData(model(), embedded).some((error) =>
            error.message.includes('does not identify a standalone entity'),
        ),
    );
});

test('validates attributes, JSON types, partition keys, and resolved IDs', () => {
    const data = samples();
    data.sampleData[0].items[0].paid = 'yes';
    data.sampleData[0].items[0].id = 'wrong';
    delete data.sampleData[0].items[0].tenantId;
    const errors = validateSampleData(model(), data);
    assert(errors.some((error) => error.path.endsWith('.paid') && error.message.includes('boolean')));
    assert(errors.some((error) => error.path.endsWith('.id') && error.message.includes('idTemplate')));
    assert(errors.some((error) => error.path.endsWith('.tenantId') && error.message.includes('partition key')));
});

test('rejects duplicate logical keys', () => {
    const data = samples();
    data.sampleData[0].items.push({ ...data.sampleData[0].items[0] });
    assert(validateSampleData(model(), data).some((error) => error.message.includes('same logical partition')));
});

test('rejects ambiguous composite IDs without an explicit identity mapping', () => {
    const definition = model();
    const entity = definition.containers[0].entities[0];
    entity.idTemplate = 'order-{OrderID}-{LineID}';
    entity.attributes.find((attribute) => attribute.target === 'orderId').type = 'string';
    entity.attributes.push({
        target: 'lineId',
        source: { table: 'Orders', column: 'LineID', type: 'varchar' },
        type: 'string',
    });
    const data = samples();
    Object.assign(data.sampleData[0].items[0], { orderId: 'a-b', lineId: 'c', id: 'order-a-b-c' });
    assert(validateSampleData(definition, data).some((error) => /identity|ambiguous/iu.test(error.message)));
});

test('rejects unresolved placeholders, including inside credential-named fields', () => {
    const data = samples();
    data.sampleData[0].items[0].notes = '{replaceMe}';
    data.sampleData[0].items[0].authentication = { password: '<value>', sessions: [{ token: 'TBD' }] };
    const errors = validateSampleData(model(), data);
    assert.deepEqual(errors, [
        { path: '$.sampleData[0].items[0].notes', message: 'contains an unresolved placeholder' },
        { path: '$.sampleData[0].items[0].authentication.password', message: 'contains an unresolved placeholder' },
        { path: '$.sampleData[0].items[0].authentication.sessions[0].token', message: 'contains an unresolved placeholder' },
    ]);
});
