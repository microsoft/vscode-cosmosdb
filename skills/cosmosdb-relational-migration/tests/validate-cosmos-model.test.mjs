import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    canonicalStringify,
    TARGET_JSON_TYPES,
    validateAndCanonicalize,
    validateCosmosModel,
    writeFileAtomic,
} from '../scripts/validate-cosmos-model.mjs';

function validModel() {
    return {
        version: 1,
        databaseName: 'sales-migration',
        capacityMode: 'provisioned',
        domain: 'all',
        sourceType: 'SQL Server',
        containers: [
            {
                name: 'Orders',
                partitionKeys: [
                    { path: '/tenantId', candidates: [{ path: '/id', score: 10 }], analysis: 'transient' },
                    { path: '/customerId' },
                ],
                entities: [
                    {
                        name: 'Order',
                        docType: 'order',
                        sourceTable: 'Sales.Orders',
                        idTemplate: 'order-{OrderID}',
                        attributes: [
                            {
                                target: 'tenantId',
                                source: { table: 'Orders', column: 'TenantID', type: 'int' },
                                type: 'number',
                                isPartitionKey: true,
                                isId: false,
                            },
                            {
                                target: 'id',
                                source: { table: 'Orders', column: 'OrderID', type: 'int' },
                                type: 'string',
                                isId: true,
                                isPartitionKey: false,
                            },
                            {
                                target: 'orderId',
                                source: { table: 'Orders', column: 'OrderID', type: 'int' },
                                type: 'number',
                            },
                            {
                                target: 'customerId',
                                source: { table: 'Orders', column: 'CustomerID', type: 'int' },
                                type: 'number',
                                isPartitionKey: true,
                            },
                        ],
                        relationships: [
                            {
                                targetEntity: 'Customer',
                                sourceFK: { table: 'Orders', column: 'CustomerID', type: 'int' },
                                type: 'many-to-many',
                                strategy: 'reference',
                                score: 90,
                                rationale: 'transient',
                            },
                        ],
                    },
                    {
                        name: 'Customer',
                        docType: 'customer',
                        sourceTable: 'Sales.Customers',
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
                                type: 'number',
                                isPartitionKey: true,
                            },
                            {
                                target: 'tenantId',
                                source: { table: 'Customers', column: 'TenantID', type: 'int' },
                                type: 'number',
                                isPartitionKey: true,
                            },
                        ],
                    },
                ],
                indexingPolicy: {
                    indexingMode: 'consistent',
                    automatic: true,
                    includedPaths: [{ path: '/*' }],
                    excludedPaths: [{ path: '/"_etag"/?' }],
                    compositeIndexes: [
                        [
                            { path: '/tenantId', order: 'ascending' },
                            { path: '/createdAt', order: 'descending' },
                        ],
                    ],
                },
                maxThroughput: 4000,
            },
        ],
    };
}

test('validates and canonicalizes a root model', () => {
    const result = validateAndCanonicalize(validModel());
    assert.deepEqual(result.errors, []);
    assert.equal(result.model.containers[0].partitionKeys[0].path, '/tenantId');
    assert.equal(result.model.containers[0].partitionKeys[1].path, '/customerId');
    assert.equal(result.model.containers[0].partitionKeys[0].candidates, undefined);
    assert.equal(result.model.containers[0].entities[1].relationships[0].rationale, undefined);
});

test('preserves unique-key policies during canonicalization', () => {
    const model = validModel();
    const policy = { uniqueKeys: [{ paths: ['/docType', '/orderId'] }] };
    model.containers[0].uniqueKeyPolicy = policy;
    const result = validateAndCanonicalize(model);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.model.containers[0].uniqueKeyPolicy, policy);
    assert.equal(canonicalStringify(validateAndCanonicalize(result.model).model), canonicalStringify(result.model));
});

test('normalizes unique-key ordering without changing path case or mutating input', () => {
    const model = validModel();
    model.containers[0].uniqueKeyPolicy = {
        uniqueKeys: [{ paths: ['/profile/Email', '/docType'] }, { paths: ['/profile/email'] }],
    };
    const original = structuredClone(model);
    const first = validateAndCanonicalize(model);
    assert.deepEqual(first.errors, []);
    assert.deepEqual(model, original);
    model.containers[0].uniqueKeyPolicy.uniqueKeys.reverse();
    model.containers[0].uniqueKeyPolicy.uniqueKeys[1].paths.reverse();
    assert.equal(canonicalStringify(validateAndCanonicalize(model).model), canonicalStringify(first.model));
    const schema = JSON.parse(fs.readFileSync(new URL('../schemas/cosmos-model.schema.json', import.meta.url), 'utf8'));
    assert.equal(schema.$defs.container.properties.uniqueKeyPolicy.$ref, '#/$defs/uniqueKeyPolicy');
    assert.equal(schema.$defs.uniqueKeyPolicy.properties.uniqueKeys.maxItems, 10);
});

test('rejects malformed, duplicate, and over-limit unique-key policies', () => {
    const invalidPolicies = [
        null, {}, { uniqueKeys: [] }, { uniqueKeys: 'email' },
        { uniqueKeys: [null] }, { uniqueKeys: [{ paths: [] }] },
        { uniqueKeys: [{ paths: ['/email'], extra: true }] },
        { uniqueKeys: [{ paths: ['/email'] }], extra: true },
        { uniqueKeys: [{ paths: ['/email', { toString: null }] }] },
        { uniqueKeys: [{ paths: ['/email', '/email'] }] },
        { uniqueKeys: [{ paths: ['/email', '/name'] }, { paths: ['/name', '/email'] }] },
        { uniqueKeys: Array.from({ length: 11 }, (_, index) => ({ paths: [`/value${index}`] })) },
        { uniqueKeys: [
            { paths: Array.from({ length: 9 }, (_, index) => `/first${index}`) },
            { paths: Array.from({ length: 8 }, (_, index) => `/second${index}`) },
        ] },
        ...[null, '', 'email', '/', '/email/?', '/email/*', '/items/[]/email', '/items/[0]/email']
            .map(uniquePath => ({ uniqueKeys: [{ paths: [uniquePath] }] })),
    ];
    for (const policy of invalidPolicies) {
        const model = validModel();
        model.containers[0].uniqueKeyPolicy = policy;
        const result = validateAndCanonicalize(model);
        assert.equal(result.model, undefined, JSON.stringify(policy));
        assert(result.errors.some(error => error.path.includes('.uniqueKeyPolicy')), JSON.stringify(policy));
    }
});

test('schema and runtime agree on target JSON types without restricting source database types', () => {
    const schema = JSON.parse(fs.readFileSync(new URL('../schemas/cosmos-model.schema.json', import.meta.url), 'utf8'));
    assert.deepEqual(schema.$defs.attribute.properties.type.enum, TARGET_JSON_TYPES);
    assert.equal(schema.$defs.source.properties.type.enum, undefined);
    for (const type of TARGET_JSON_TYPES) {
        const definition = validModel();
        definition.containers[0].entities[0].attributes.push({
            target: 'value', source: { table: 'Orders', column: 'Value', type: 'decimal(38,18)' }, type,
        });
        const result = validateAndCanonicalize(definition);
        assert.deepEqual(result.errors, [], type);
        const attribute = result.model.containers[0].entities.find(entity => entity.name === 'Order')
            .attributes.find(attribute => attribute.target === 'value');
        assert.equal(attribute.type, type);
        assert.equal(attribute.source.type, 'decimal(38,18)');
    }
});

test('rejects unsupported target types on standalone and embedded attributes', () => {
    for (const type of ['decimal', 'varchar', 'uuid', 'datetime', 'String', 'string?', 'string|null', ['string', 'null'], '', null, undefined]) {
        for (const embedded of [false, true]) {
            const definition = validModel();
            const attribute = { target: 'value', source: { table: 'Orders', column: 'Value', type: 'decimal' }, type };
            if (embedded) {
                definition.containers[0].entities.push({
                    name: 'Detail', docType: 'detail', sourceTable: 'Sales.Details', isEmbeddedOnly: true,
                    attributes: [attribute],
                });
            } else definition.containers[0].entities[0].attributes.push(attribute);
            const result = validateAndCanonicalize(definition);
            assert.equal(result.model, undefined);
            assert(result.errors.some(error => error.path.endsWith('.type') && error.message.includes('target JSON type')));
        }
    }
});

test('CLI rejects unsupported target types without replacing canonical output', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-target-types-'));
    try {
        const input = path.join(directory, 'input.json');
        const output = path.join(directory, 'model.json');
        const definition = validModel();
        definition.containers[0].entities[0].attributes.push({
            target: 'amount', source: { table: 'Orders', column: 'Amount', type: 'decimal(38,18)' }, type: 'decimal',
        });
        fs.writeFileSync(input, JSON.stringify(definition));
        fs.writeFileSync(output, 'existing output\n');
        const script = fileURLToPath(new URL('../scripts/validate-cosmos-model.mjs', import.meta.url));
        for (const args of [['--check'], ['--output', output]]) {
            const result = spawnSync(process.execPath, [script, input, ...args], { encoding: 'utf8' });
            assert.equal(result.status, 1, result.stderr);
            assert.equal(result.stdout, '');
            const report = JSON.parse(result.stderr);
            assert.equal(report.valid, false);
            assert(report.errors.some(error => error.path.endsWith('.type') && error.message.includes('target JSON type')));
            assert.equal(fs.readFileSync(output, 'utf8'), 'existing output\n');
        }
    } finally {
        fs.rmSync(directory, { recursive: true });
    }
});

test('canonicalization is byte stable and preserves meaningful ordering', () => {
    const first = validateAndCanonicalize(validModel());
    const firstText = canonicalStringify(first.model);
    const second = validateAndCanonicalize(JSON.parse(firstText));
    assert.equal(canonicalStringify(second.model), firstText);
    assert.deepEqual(
        second.model.containers[0].partitionKeys.map((partitionKey) => partitionKey.path),
        ['/tenantId', '/customerId'],
    );
    assert.deepEqual(
        second.model.containers[0].indexingPolicy.compositeIndexes[0].map((entry) => entry.path),
        ['/tenantId', '/createdAt'],
    );
});

test('rejects missing identity and partition-key alignment', () => {
    const model = validModel();
    model.containers[0].entities[0].idTemplate = undefined;
    model.containers[0].entities[0].attributes = model.containers[0].entities[0].attributes.filter(
        (attribute) => attribute.target !== 'tenantId',
    );
    const errors = validateCosmosModel(model);
    assert(errors.some((error) => error.path.endsWith('.idTemplate')));
    assert(errors.some((error) => error.message.includes('/tenantId')));
});

test('enforces deterministic ID templates and natural-key preservation', () => {
    const model = validModel();
    model.containers[0].entities[0].idTemplate = '{OrderID}';
    model.containers[0].entities[0].attributes = model.containers[0].entities[0].attributes.filter(
        (attribute) => attribute.target !== 'orderId',
    );
    const errors = validateCosmosModel(model);
    assert(errors.some((error) => error.message.includes('must start with "order-"')));
    assert(errors.some((error) => error.message.includes('separate natural-key attribute')));
});

test('accepts direct and prefixed UUID identities while enforcing generated fallback', () => {
    for (const sourceType of ['uuid', 'GUID', 'UniqueIdentifier']) {
        const nativeModel = validModel();
        const nativeEntity = nativeModel.containers[0].entities[0];
        nativeEntity.attributes.find((attribute) => attribute.isId).source.type = sourceType;
        const naturalKey = nativeEntity.attributes.find((attribute) => attribute.target === 'orderId');
        naturalKey.source.type = sourceType;
        naturalKey.type = 'string';
        for (const idTemplate of ['{OrderID}', 'order-{OrderID}']) {
            nativeEntity.idTemplate = idTemplate;
            assert.deepEqual(validateCosmosModel(nativeModel), []);
        }
        for (const idTemplate of ['other-{OrderID}', '{OrderID}-{OrderID}']) {
            nativeEntity.idTemplate = idTemplate;
            assert(
                validateCosmosModel(nativeModel).some((error) => error.message.includes('must start with "order-"')),
            );
        }
    }

    const generatedModel = validModel();
    const generatedEntity = generatedModel.containers[0].entities[0];
    generatedEntity.attributes.find((attribute) => attribute.isId).source = {
        table: '(generated)',
        column: '(uuid)',
        type: 'uuid',
    };
    generatedEntity.idTemplate = '{uuid}';
    assert.deepEqual(validateCosmosModel(generatedModel), []);
    generatedEntity.idTemplate = 'order-{uuid}';
    assert(
        validateCosmosModel(generatedModel).some((error) => error.message.includes('generated UUID fallback')),
    );
});

test('rejects capacity and index path conflicts', () => {
    const model = validModel();
    model.capacityMode = 'serverless';
    model.containers[0].indexingPolicy.includedPaths = [{ path: '/items/*/name/?' }];
    const errors = validateCosmosModel(model);
    assert(errors.some((error) => error.path.endsWith('.maxThroughput')));
    assert(errors.some((error) => error.path.endsWith('.includedPaths[0].path')));
});

test('rejects explicit root id included paths without rewriting the model', () => {
    for (const property of ['id', '"id"', '"\\u0069d"']) {
        for (const suffix of ['?', '*']) {
            const model = validModel();
            model.containers[0].indexingPolicy.includedPaths.push({ path: `/${property}/${suffix}` });
            const original = structuredClone(model);
            const result = validateAndCanonicalize(model);
            assert(result.errors.some(error =>
                error.path === '$.containers[0].indexingPolicy.includedPaths[1].path' &&
                error.message.includes('system id')));
            assert.equal(result.model, undefined);
            assert.deepEqual(model, original);
        }
    }
});

test('preserves id partition keys, composite indexes, and nested or differently cased properties', () => {
    const model = validModel();
    const container = model.containers[0];
    container.partitionKeys.push({ path: '/id' });
    for (const entity of container.entities) entity.attributes.find(attribute => attribute.isId).isPartitionKey = true;
    container.indexingPolicy.includedPaths.push({ path: '/metadata/id/?' }, { path: '/Id/?' }, { path: '/identifier/?' });
    container.indexingPolicy.compositeIndexes.push([
        { path: '/id', order: 'ascending' },
        { path: '/tenantId', order: 'ascending' },
    ]);
    const result = validateAndCanonicalize(model);
    assert.deepEqual(result.errors, []);
    assert.equal(result.model.containers[0].partitionKeys.at(-1).path, '/id');
    assert(result.model.containers[0].indexingPolicy.compositeIndexes.some(group => group[0].path === '/id'));
});

test('rejects explicit system _etag indexing in range, composite, and full-text indexes', () => {
    for (const property of ['_etag', '"_etag"', '"_et\\u0061g"']) {
        for (const excludedPaths of [[], [{ path: '/*' }], [{ path: '/"_etag"/?' }]]) {
            for (const indexKind of ['scalar', 'subtree', 'composite', 'fullText']) {
                const model = validModel();
                const container = model.containers[0];
                const policy = container.indexingPolicy;
                policy.excludedPaths = excludedPaths;
                let expectedPath;
                if (indexKind === 'composite') {
                    policy.compositeIndexes = [[
                        { path: `/${property}`, order: 'ascending' },
                        { path: '/tenantId', order: 'ascending' },
                    ]];
                    expectedPath = '$.containers[0].indexingPolicy.compositeIndexes[0][0].path';
                } else if (indexKind === 'fullText') {
                    container.fullTextPolicy = {
                        defaultLanguage: 'en-US',
                        fullTextPaths: [{ path: `/${property}` }],
                    };
                    policy.fullTextIndexes = [{ path: `/${property}` }];
                    expectedPath = '$.containers[0].indexingPolicy.fullTextIndexes[0].path';
                } else {
                    policy.includedPaths.push({ path: `/${property}/${indexKind === 'scalar' ? '?' : '*'}` });
                    expectedPath = '$.containers[0].indexingPolicy.includedPaths[1].path';
                }
                const result = validateAndCanonicalize(model);
                assert.deepEqual(result.errors, [{
                    path: expectedPath,
                    message: 'must not explicitly index the system _etag property',
                }]);
                assert.equal(result.model, undefined);
                assert.deepEqual(result.warnings, []);
            }
        }
    }
});

test('warns without rejecting or modifying models missing an explicit _etag exclusion', () => {
    for (const indexingMode of ['consistent', undefined]) {
        const model = validModel();
        model.containers[0].indexingPolicy.indexingMode = indexingMode;
        model.containers[0].indexingPolicy.excludedPaths = [];
        const original = structuredClone(model);
        const warnings = [];
        assert.deepEqual(validateCosmosModel(model, { warnings }), []);
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0].path, '$.containers[0].indexingPolicy.excludedPaths');
        assert.match(warnings[0].message, /Cosmos DB excludes _etag by default/u);
        const result = validateAndCanonicalize(model);
        assert.deepEqual(result.errors, []);
        assert.deepEqual(result.warnings, warnings);
        assert.deepEqual(result.model.containers[0].indexingPolicy.excludedPaths, []);
        assert.deepEqual(model, original);
    }
});

test('accepts equivalent _etag exclusions, exclude-all, disabled indexing, and nested application fields', () => {
    for (const exclusion of ['/_etag/?', '/"_etag"/?', '/"_et\\u0061g"/?', '/_etag/*', '/*']) {
        const model = validModel();
        model.containers[0].indexingPolicy.excludedPaths = [{ path: exclusion }];
        model.containers[0].indexingPolicy.includedPaths.push({ path: '/metadata/_etag/?' }, { path: '/_ETag/?' });
        const result = validateAndCanonicalize(model);
        assert.deepEqual(result.errors, []);
        assert.deepEqual(result.warnings, []);
    }
    const model = validModel();
    model.containers[0].indexingPolicy = { indexingMode: 'none', includedPaths: [], excludedPaths: [] };
    const result = validateAndCanonicalize(model);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
});

test('reports _etag warnings in CLI checks without failing or contaminating canonical JSON output', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-etag-warning-'));
    try {
        const model = validModel();
        model.containers[0].indexingPolicy.excludedPaths = [];
        const input = path.join(directory, 'model.json');
        fs.writeFileSync(input, canonicalStringify(model));
        const validator = new URL('../scripts/validate-cosmos-model.mjs', import.meta.url);
        for (const args of [[input, '--check'], [input]]) {
            const result = spawnSync(process.execPath, [fileURLToPath(validator), ...args], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            const output = JSON.parse(result.stdout);
            const report = args.includes('--check') ? output : JSON.parse(result.stderr);
            assert.equal(report.warnings.length, 1);
            if (args.includes('--check')) assert.equal(output.valid, true);
            else assert.deepEqual(output, validateAndCanonicalize(model).model);
        }
    } finally {
        fs.rmSync(directory, { recursive: true });
    }
});

test('accepts eight properties per composite index and more than eight separate indexes', () => {
    const model = validModel();
    const compositeIndexes = Array.from({ length: 9 }, (_, groupIndex) =>
        Array.from({ length: 8 }, (_, propertyIndex) => ({
            path: `/field${groupIndex}_${propertyIndex}`,
            order: 'ascending',
        })),
    );
    model.containers[0].indexingPolicy.compositeIndexes = compositeIndexes;
    const result = validateAndCanonicalize(model);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.model.containers[0].indexingPolicy.compositeIndexes, compositeIndexes);
});

test('rejects nine properties in a composite index before canonicalization', () => {
    const model = validModel();
    model.containers[0].indexingPolicy.compositeIndexes.push(
        Array.from({ length: 9 }, (_, propertyIndex) => ({
            path: `/field${propertyIndex}`,
            order: 'ascending',
        })),
    );
    const result = validateAndCanonicalize(model);
    assert.deepEqual(result.errors, [
        {
            path: '$.containers[0].indexingPolicy.compositeIndexes[1]',
            message: 'must contain at most 8 item(s)',
        },
    ]);
    assert.equal(result.model, undefined);
});

test('declares the composite-index width limit on each group in the JSON schema', () => {
    const schema = JSON.parse(fs.readFileSync(new URL('../schemas/cosmos-model.schema.json', import.meta.url), 'utf8'));
    const compositeIndexes = schema.$defs.indexingPolicy.properties.compositeIndexes;
    assert.equal(compositeIndexes.items.minItems, 2);
    assert.equal(compositeIndexes.items.maxItems, 8);
    assert.equal(compositeIndexes.maxItems, undefined);
});

test('leaves serverless service-limit eligibility to current best-practice guidance', () => {
    const model = validModel();
    model.capacityMode = 'serverless';
    delete model.containers[0].maxThroughput;
    model.containers[0].estimatedStorageGB = 1025;
    const errors = validateCosmosModel(model);
    assert.deepEqual(errors, []);
});

test('accepts the TypeScript relationship source-FK shape without a source type', () => {
    const model = validModel();
    delete model.containers[0].entities[0].relationships[0].sourceFK.type;
    const result = validateAndCanonicalize(model);
    assert.deepEqual(result.errors, []);
    assert.equal(result.model.containers[0].entities[1].relationships[0].sourceFK.type, undefined);
});

test('requires an explicit embed or reference strategy for every relationship', () => {
    const model = validModel();
    delete model.containers[0].entities[0].relationships[0].strategy;
    assert.deepEqual(validateCosmosModel(model), [
        {
            path: '$.containers[0].entities[0].relationships[0].strategy',
            message: 'must be embed or reference',
        },
    ]);

    const schema = JSON.parse(fs.readFileSync(new URL('../schemas/cosmos-model.schema.json', import.meta.url), 'utf8'));
    assert(schema.$defs.relationship.required.includes('strategy'));
});

test('requires an explicit target property only for embedded relationships', () => {
    const model = validModel();
    const relationship = model.containers[0].entities[0].relationships[0];
    relationship.strategy = 'embed';
    assert(
        validateCosmosModel(model).some(error =>
            error.path.endsWith('.targetProperty') && error.message === 'must be a non-empty string'
        ),
    );
    relationship.targetProperty = 'customer';
    assert.deepEqual(validateCosmosModel(model), []);
    relationship.strategy = 'reference';
    assert(
        validateCosmosModel(model).some(error =>
            error.path.endsWith('.targetProperty') && error.message.includes('only for embed')
        ),
    );
});

test('rejects reference relationships to embedded-only entities', () => {
    const model = validModel();
    model.containers[0].entities[1].isEmbeddedOnly = true;
    const errors = validateCosmosModel(model);
    assert(errors.some(error =>
        error.path === '$.containers[0].entities[0].relationships[0].targetEntity' &&
        error.message === 'reference relationships require a standalone target entity'
    ));
});

test('rejects reference relationships from embedded-only entities', () => {
    const model = validModel();
    const [order, customer] = model.containers[0].entities;
    order.relationships = undefined;
    customer.isEmbeddedOnly = true;
    customer.relationships = [
        {
            targetEntity: 'Order',
            sourceFK: { table: 'Customers', column: 'OrderID', type: 'int' },
            type: 'one-to-one',
            strategy: 'reference',
        },
    ];
    const errors = validateCosmosModel(model);
    assert(errors.some(error =>
        error.path === '$.containers[0].entities[1].relationships[0].strategy' &&
        error.message === 'reference relationships require a standalone source entity'
    ));
});

test('rejects the legacy full-text policy nested inside indexingPolicy', () => {
    const model = validModel();
    model.containers[0].indexingPolicy.fullTextPolicy = {
        defaultLanguage: 'en-US',
        paths: ['/description'],
    };
    model.containers[0].indexingPolicy.fullTextIndexes = [{ path: '/description' }];
    const errors = validateCosmosModel(model);
    assert(errors.some((error) => error.path.endsWith('.indexingPolicy.fullTextPolicy')));
});

test('canonicalizes service-shaped full-text policies with default and per-path languages', () => {
    const model = validModel();
    const container = model.containers[0];
    container.fullTextPolicy = {
        defaultLanguage: 'en-US',
        fullTextPaths: [{ path: '/title', language: 'de-DE' }, { path: '/description' }, { path: '/tags/[]' }],
    };
    container.indexingPolicy.fullTextIndexes = [{ path: '/title' }, { path: '/description' }, { path: '/tags/[]' }];
    const original = structuredClone(model);
    const result = validateAndCanonicalize(model);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.model.containers[0].fullTextPolicy, {
        defaultLanguage: 'en-US',
        fullTextPaths: [
            { path: '/description', language: 'en-US' },
            { path: '/tags/[]', language: 'en-US' },
            { path: '/title', language: 'de-DE' },
        ],
    });
    assert.deepEqual(result.model.containers[0].indexingPolicy.fullTextIndexes, [
        { path: '/description' },
        { path: '/tags/[]' },
        { path: '/title' },
    ]);
    assert.deepEqual(validateAndCanonicalize(result.model).model, result.model);
    assert.deepEqual(model, original);
    delete container.indexingPolicy.fullTextIndexes;
    assert.deepEqual(validateCosmosModel(model), []);
});

test('rejects malformed or mismatched full-text configuration without throwing', () => {
    const mutations = [
        (container) => {
            delete container.fullTextPolicy;
        },
        (container) => {
            container.fullTextPolicy = null;
        },
        (container) => {
            container.fullTextPolicy.fullTextPaths = {};
        },
        (container) => {
            container.fullTextPolicy.fullTextPaths = [];
        },
        (container) => {
            container.fullTextPolicy.fullTextPaths = [null];
        },
        (container) => {
            container.fullTextPolicy.defaultLanguage = '';
        },
        (container) => {
            container.fullTextPolicy.fullTextPaths[0].language = 1;
        },
        (container) => {
            container.fullTextPolicy.fullTextPaths.push({ path: '/description' });
        },
        (container) => {
            container.indexingPolicy.fullTextIndexes = {};
        },
        (container) => {
            container.indexingPolicy.fullTextIndexes = [null];
        },
        (container) => {
            container.indexingPolicy.fullTextIndexes.push({ path: '/description' });
        },
        (container) => {
            container.indexingPolicy.fullTextIndexes[0].path = '/Description';
        },
        (container) => {
            container.indexingPolicy.indexingMode = 'none';
        },
        ...['/description/?', '/description/*', 'description', '/items/*/text', '/items/[]/{text,title}'].map(
            (indexPath) => (container) => {
                container.fullTextPolicy.fullTextPaths[0].path = indexPath;
                container.indexingPolicy.fullTextIndexes[0].path = indexPath;
            },
        ),
    ];
    for (const mutate of mutations) {
        const model = validModel();
        const container = model.containers[0];
        container.fullTextPolicy = { defaultLanguage: 'en-US', fullTextPaths: [{ path: '/description' }] };
        container.indexingPolicy.fullTextIndexes = [{ path: '/description' }];
        mutate(container);
        const result = validateAndCanonicalize(model);
        assert(result.errors.length > 0, mutate.toString());
        assert.equal(result.model, undefined);
    }
});

test('declares full-text policy on the container in the JSON schema', () => {
    const schema = JSON.parse(fs.readFileSync(new URL('../schemas/cosmos-model.schema.json', import.meta.url), 'utf8'));
    assert.deepEqual(schema.$defs.container.properties.fullTextPolicy, { $ref: '#/$defs/fullTextPolicy' });
    assert.equal(schema.$defs.indexingPolicy.properties.fullTextPolicy, undefined);
    assert.deepEqual(schema.$defs.fullTextPolicy.required, ['defaultLanguage', 'fullTextPaths']);
});

test('leaves projection ownership to source evidence while rejecting unresolved placeholders', () => {
    const model = validModel();
    model.containers[0].entities[1].sourceTable = 'Sales.Orders';
    model.databaseName = 'REPLACE_ME';
    const errors = validateCosmosModel(model);
    assert(!errors.some((error) => error.message.includes('source table mapping')));
    assert(errors.some((error) => error.message.includes('unresolved placeholder')));
});

test('canonicalizes optional analysis arrays independently of input key order', () => {
    const firstModel = validModel();
    firstModel.accessPatterns = [
        {
            target: {
                operation: 'query',
                isCrossPartition: false,
                container: 'Orders',
                type: 'query',
            },
            source: { query: 'SELECT 1', type: 'read' },
            name: 'ReadOrders',
        },
    ];
    const secondModel = JSON.parse(JSON.stringify(firstModel));
    secondModel.accessPatterns[0] = {
        name: 'ReadOrders',
        source: { type: 'read', query: 'SELECT 1' },
        target: {
            type: 'query',
            container: 'Orders',
            operation: 'query',
            isCrossPartition: false,
        },
    };
    const first = validateAndCanonicalize(firstModel);
    const second = validateAndCanonicalize(secondModel);
    assert.equal(canonicalStringify(first.model), canonicalStringify(second.model));
});

test('does not replace an existing output after validation failure', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-model-test-'));
    const outputPath = path.join(directory, 'model.json');
    writeFileAtomic(outputPath, '{"existing":true}\n');
    const invalid = validModel();
    invalid.version = 2;
    const result = validateAndCanonicalize(invalid);
    if (result.errors.length === 0) writeFileAtomic(outputPath, canonicalStringify(result.model));
    assert.equal(fs.readFileSync(outputPath, 'utf8'), '{"existing":true}\n');
    fs.rmSync(directory, { recursive: true });
});
