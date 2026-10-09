import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { mergeCosmosModels } from '../scripts/merge-cosmos-models.mjs';
import { canonicalStringify, validateCosmosModel } from '../scripts/validate-cosmos-model.mjs';

function entity(name, sourceTable, partitionKey = 'tenantId') {
    return {
        name,
        docType: name.toLocaleLowerCase('en-US'),
        sourceTable,
        idTemplate: `${name.toLocaleLowerCase('en-US')}-{Id}`,
        attributes: [
            {
                target: 'id',
                source: { table: sourceTable, column: 'Id', type: 'int' },
                type: 'string',
                isId: true,
            },
            {
                target: `${name.slice(0, 1).toLocaleLowerCase('en-US')}${name.slice(1)}Id`,
                source: { table: sourceTable, column: 'Id', type: 'int' },
                type: 'number',
            },
            {
                target: partitionKey,
                source: { table: sourceTable, column: partitionKey, type: 'varchar' },
                type: 'string',
                isPartitionKey: true,
            },
        ],
    };
}

function domainModel(domain, containerName, entityValue, options = {}) {
    return {
        version: 1,
        domain,
        sourceType: 'SQL Server',
        containers: [
            {
                name: containerName,
                partitionKeys: [{ path: `/${options.partitionKey ?? 'tenantId'}` }],
                entities: [entityValue],
                indexingPolicy: {
                    indexingMode: options.indexingMode ?? 'consistent',
                    automatic: true,
                    includedPaths: [{ path: options.includedPath ?? '/*' }],
                    excludedPaths: [
                        { path: '/"_etag"/?' },
                        ...(options.includedPath && options.includedPath !== '/*' ? [{ path: '/*' }] : []),
                    ],
                },
            },
        ],
    };
}

const mergeOptions = { databaseName: 'migration-db', capacityMode: 'serverless' };
const mergeScriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'merge-cosmos-models.mjs');

test('surfaces _etag warnings while merging and blocks explicit indexing without replacing output', () => {
    const model = domainModel('Sales', 'Orders', entity('Order', 'Sales.Orders'));
    model.containers[0].indexingPolicy.excludedPaths = [];
    const merged = mergeCosmosModels([{ domainName: 'Sales', model }], mergeOptions);
    assert.deepEqual(merged.errors, []);
    assert.deepEqual(merged.conflicts, []);
    assert.equal(merged.warnings.length, 1);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-etag-'));
    try {
        const input = path.join(directory, 'sales.json');
        const output = path.join(directory, 'model.json');
        fs.writeFileSync(input, canonicalStringify(model));
        const args = [
            mergeScriptPath, '--database', 'migration-db', '--capacity', 'serverless',
            '--output', output, '--input', `Sales=${input}`,
        ];
        const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).valid, true);
        assert.deepEqual(JSON.parse(result.stdout).warnings, merged.warnings);
        const original = fs.readFileSync(output, 'utf8');
        model.containers[0].indexingPolicy.includedPaths.push({ path: '/_etag/?' });
        fs.writeFileSync(input, canonicalStringify(model));
        const rejected = spawnSync(process.execPath, args, { encoding: 'utf8' });
        assert.equal(rejected.status, 1);
        assert.match(JSON.parse(rejected.stderr).errors[0].message, /must not explicitly index/u);
        assert.equal(fs.readFileSync(output, 'utf8'), original);
    } finally {
        fs.rmSync(directory, { recursive: true });
    }
});

test('resolves cyclic cross-domain references without weakening standalone validation', () => {
    const order = entity('Order', 'Sales.Orders');
    const customer = entity('Customer', 'Sales.Customers');
    order.relationships = [{ targetEntity: 'Customer', sourceFK: { table: 'Orders', column: 'CustomerId' }, type: 'one-to-one', strategy: 'reference' }];
    customer.relationships = [{ targetEntity: 'Order', sourceFK: { table: 'Customers', column: 'LatestOrderId' }, type: 'one-to-one', strategy: 'reference' }];
    const orders = domainModel('Sales', 'Orders', order);
    const customers = domainModel('Accounts', 'Customers', customer);
    assert(validateCosmosModel(orders).some(error => error.path.endsWith('targetEntity')));
    const result = mergeCosmosModels([{ domainName: 'Sales', model: orders }, { domainName: 'Accounts', model: customers }], mergeOptions);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(validateCosmosModel(result.model), []);
    assert.equal(mergeCosmosModels([{ domainName: 'Sales', model: orders }], mergeOptions).model, undefined);
});

test('rejects ambiguous external entity names and mismatched domain identities', () => {
    const first = domainModel('First', 'One', entity('Item', 'one.Items'));
    const second = domainModel('Second', 'Two', entity('Item', 'two.Items'));
    assert.equal(mergeCosmosModels([{ domainName: 'First', model: first }, { domainName: 'Second', model: second }], mergeOptions).model, undefined);
    assert.equal(mergeCosmosModels([{ domainName: 'Wrong', model: first }], mergeOptions).model, undefined);
});

test('merges disjoint domains to byte-identical canonical output regardless of input order', () => {
    const sales = { domainName: 'Sales', model: domainModel('Sales', 'Orders', entity('Order', 'Sales.Orders')) };
    const catalog = {
        domainName: 'Catalog',
        model: domainModel('Catalog', 'Products', entity('Product', 'Catalog.Products')),
    };
    const first = mergeCosmosModels([sales, catalog], mergeOptions);
    const second = mergeCosmosModels([catalog, sales], mergeOptions);
    assert.deepEqual(first.errors, []);
    assert.deepEqual(first.conflicts, []);
    assert.equal(canonicalStringify(first.model), canonicalStringify(second.model));
});

test('unions compatible same-container entities and index paths', () => {
    const orders = {
        domainName: 'Orders',
        model: domainModel('Orders', 'Commerce', entity('Order', 'Sales.Orders'), {
            includedPath: '/orderDate/?',
        }),
    };
    const catalog = {
        domainName: 'Catalog',
        model: domainModel('Catalog', 'Commerce', entity('Product', 'Catalog.Products'), {
            includedPath: '/sku/?',
        }),
    };
    const result = mergeCosmosModels([orders, catalog], mergeOptions);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(
        result.model.containers[0].entities.map((value) => value.name),
        ['Order', 'Product'],
    );
    assert.deepEqual(
        result.model.containers[0].indexingPolicy.includedPaths.map((value) => value.path),
        ['/orderDate/?', '/sku/?'],
    );
});

test('preserves agreed unique-key policies and rejects incompatible shared-container policies', () => {
    const domains = ['Sales', 'Catalog'].map(domainName => ({
        domainName,
        model: domainModel(domainName, 'Shared', entity(domainName, `${domainName}.Items`)),
    }));
    const policy = { uniqueKeys: [{ paths: ['/docType', '/name'] }, { paths: ['/code'] }] };
    for (const { model } of domains) model.containers[0].uniqueKeyPolicy = structuredClone(policy);
    const first = mergeCosmosModels(domains, mergeOptions);
    assert.deepEqual(first.errors, []);
    assert.deepEqual(first.conflicts, []);
    assert.equal(first.model.containers[0].uniqueKeyPolicy.uniqueKeys.length, 2);
    domains[1].model.containers[0].uniqueKeyPolicy.uniqueKeys[0].paths.reverse();
    domains[1].model.containers[0].uniqueKeyPolicy.uniqueKeys.reverse();
    assert.deepEqual(mergeCosmosModels(domains, mergeOptions).model, first.model);
    assert.deepEqual(mergeCosmosModels([...domains].reverse(), mergeOptions).model, first.model);
    for (const changedPolicy of [undefined, { uniqueKeys: [{ paths: ['/other'] }] }]) {
        domains[1].model.containers[0].uniqueKeyPolicy = changedPolicy;
        const result = mergeCosmosModels(domains, mergeOptions);
        assert.equal(result.model, undefined);
        assert(result.conflicts.some(conflict => conflict.includes('unique-key policies differ')));
    }
});

test('ignores partition-key analysis and candidates when merging matching paths', () => {
    const domains = ['Sales', 'Catalog'].map(domainName => ({
        domainName,
        model: domainModel(domainName, 'Shared', entity(domainName, `${domainName}.Items`)),
    }));
    Object.assign(domains[0].model.containers[0].partitionKeys[0], {
        analysis: 'Align tenant reads.',
        candidates: ['/tenantId', '/id'],
    });
    Object.assign(domains[1].model.containers[0].partitionKeys[0], {
        analysis: 'Distribute writes across tenants.',
        candidates: ['/id', '/tenantId'],
    });
    const original = structuredClone(domains);
    const result = mergeCosmosModels(domains, mergeOptions);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.model.containers[0].partitionKeys, [{ path: '/tenantId' }]);
    assert.deepEqual(mergeCosmosModels([...domains].reverse(), mergeOptions).model, result.model);
    assert.deepEqual(domains, original);

    domains[1].model.containers[0].partitionKeys = [{ path: '/tenantId' }];
    assert.deepEqual(mergeCosmosModels(domains, mergeOptions).model, result.model);
});

test('preserves hierarchical partition-key order and rejects different ordering or path counts', () => {
    const domains = ['Sales', 'Catalog'].map(domainName => ({
        domainName,
        model: domainModel(domainName, 'Shared', entity(domainName, `${domainName}.Items`)),
    }));
    for (const { model } of domains) {
        const container = model.containers[0];
        container.partitionKeys.push({ path: '/region' });
        container.entities[0].attributes.push({
            target: 'region',
            source: { table: `${model.domain}.Items`, column: 'region', type: 'varchar' },
            type: 'string',
            isPartitionKey: true,
        });
    }
    domains[0].model.containers[0].partitionKeys[1].analysis = 'Second-level region routing.';
    const result = mergeCosmosModels(domains, mergeOptions);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.model.containers[0].partitionKeys, [{ path: '/tenantId' }, { path: '/region' }]);
    assert.deepEqual(mergeCosmosModels([...domains].reverse(), mergeOptions).model, result.model);

    domains[1].model.containers[0].partitionKeys.reverse();
    const reordered = mergeCosmosModels(domains, mergeOptions);
    assert.deepEqual(reordered.errors, []);
    assert.equal(reordered.model, undefined);
    assert(reordered.conflicts.some(conflict => conflict.includes('partition keys differ')));

    domains[1].model.containers[0].partitionKeys = [{ path: '/tenantId' }];
    delete domains[1].model.containers[0].entities[0].attributes.at(-1).isPartitionKey;
    const shortened = mergeCosmosModels(domains, mergeOptions);
    assert.deepEqual(shortened.errors, []);
    assert.equal(shortened.model, undefined);
    assert(shortened.conflicts.some(conflict => conflict.includes('partition keys differ')));
});

test('merges full-text paths and indexes deterministically without losing per-path languages', () => {
    const domains = ['Catalog', 'Sales'].map((domainName) => ({
        domainName,
        model: domainModel(domainName, 'Shared', entity(domainName, `${domainName}.Items`)),
    }));
    for (const [index, entry] of domains.entries()) {
        const container = entry.model.containers[0];
        const indexPath = index ? '/title' : '/description';
        container.fullTextPolicy = {
            defaultLanguage: 'en-US',
            fullTextPaths: [{ path: indexPath }, { path: '/shared', language: 'fr-FR' }],
        };
        container.indexingPolicy.fullTextIndexes = [{ path: indexPath }, { path: '/shared' }];
    }
    const result = mergeCosmosModels(domains, mergeOptions);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.model.containers[0].fullTextPolicy.fullTextPaths, [
        { path: '/description', language: 'en-US' },
        { path: '/shared', language: 'fr-FR' },
        { path: '/title', language: 'en-US' },
    ]);
    assert.deepEqual(result.model.containers[0].indexingPolicy.fullTextIndexes, [
        { path: '/description' },
        { path: '/shared' },
        { path: '/title' },
    ]);
    assert.deepEqual(mergeCosmosModels([...domains].reverse(), mergeOptions).model, result.model);
    for (const domain of domains) {
        const withoutPolicy = structuredClone(domains);
        const container = withoutPolicy.find((entry) => entry.domainName === domain.domainName).model.containers[0];
        delete container.fullTextPolicy;
        delete container.indexingPolicy.fullTextIndexes;
        const merged = mergeCosmosModels(withoutPolicy, mergeOptions);
        assert.deepEqual(merged.errors, []);
        assert.equal(merged.model.containers[0].fullTextPolicy.fullTextPaths.length, 2);
    }
    domains[1].model.containers[0].fullTextPolicy.fullTextPaths[1].language = 'de-DE';
    assert(
        mergeCosmosModels(domains, mergeOptions).conflicts.some((conflict) =>
            conflict.includes('language differs for path'),
        ),
    );
    domains[1].model.containers[0].fullTextPolicy.defaultLanguage = 'de-DE';
    assert(
        mergeCosmosModels(domains, mergeOptions).conflicts.some((conflict) =>
            conflict.includes('default language differs'),
        ),
    );
    domains[1].model.containers[0].fullTextPolicy.fullTextPaths = null;
    assert(mergeCosmosModels(domains, mergeOptions).errors.length > 0);
});

test('requires contribution evidence rather than losing equal shared-container estimates', () => {
    const domains = ['Sales', 'Accounts'].map((domainName, index) => ({ domainName,
        model: domainModel(domainName, 'Shared', entity(index ? 'Customer' : 'Order', `${domainName}.Items`)),
    }));
    domains.forEach(entry => { entry.model.containers[0].maxThroughput = 4000; });
    const options = { ...mergeOptions, capacityMode: 'provisioned' };
    assert.equal(mergeCosmosModels(domains, options).model, undefined);
    options.capacityEvidence = { version: 1, containers: [{ name: 'Shared', storage: [], operations: domains.map(entry => ({
        id: entry.domainName, domains: [entry.domainName], ruPerOperation: 1, operationsPerSecond: 4000, window: 'peak', source: 'patterns.md',
    })) }] };
    assert.equal(mergeCosmosModels(domains, options).model.containers[0].maxThroughput, 8000);
});

test('blocks incompatible partition keys instead of selecting one', () => {
    const tenant = {
        domainName: 'Tenant',
        model: domainModel('Tenant', 'Commerce', entity('Order', 'Sales.Orders')),
    };
    const customer = {
        domainName: 'Customer',
        model: domainModel('Customer', 'Commerce', entity('Customer', 'Sales.Customers', 'customerId'), {
            partitionKey: 'customerId',
        }),
    };
    const result = mergeCosmosModels([tenant, customer], mergeOptions);
    assert.equal(result.model, undefined);
    assert(result.conflicts.some((conflict) => conflict.includes('partition keys differ')));
});

test('blocks contradictory include and exclude index paths', () => {
    const included = {
        domainName: 'Included',
        model: domainModel('Included', 'Commerce', entity('Order', 'Sales.Orders'), {
            includedPath: '/status/?',
        }),
    };
    const excludedModel = domainModel('Excluded', 'Commerce', entity('Product', 'Catalog.Products'));
    excludedModel.containers[0].indexingPolicy.excludedPaths.push({ path: '/status/?' });
    const result = mergeCosmosModels([{ domainName: 'Excluded', model: excludedModel }, included], mergeOptions);
    assert.equal(result.model, undefined);
    assert(result.conflicts.some((conflict) => conflict.includes('both included and excluded')));
});

test('reports invalid domain models with domain-qualified paths', () => {
    const invalid = domainModel('Sales', 'Orders', entity('Order', 'Sales.Orders'));
    delete invalid.containers[0].entities[0].idTemplate;
    const result = mergeCosmosModels([{ domainName: 'Sales', model: invalid }], mergeOptions);
    assert.equal(result.model, undefined);
    assert(result.errors.some((error) => error.path.startsWith('Sales:') && error.path.endsWith('.idTemplate')));
});

test('validates and merges domain manifests without model or registry sidecars', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-merge-'));
    try {
        const order = entity('Order', 'Sales.Orders');
        const customer = entity('Customer', 'Accounts.Customers');
        order.relationships = [{ targetEntity: 'Customer', sourceFK: { table: 'Sales.Orders', column: 'CustomerId' }, type: 'one-to-one', strategy: 'reference' }];
        const sales = domainModel('Sales', 'Orders', order);
        const accounts = domainModel('Accounts', 'Customers', customer);
        const referenceRegistry = [sales, accounts].flatMap(model => model.containers.flatMap(container => container.entities.map(value => ({ domain: model.domain, name: value.name, sourceTable: value.sourceTable }))));
        const manifestPath = path.join(directory, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, blockingIssues: [], ...mergeOptions, referenceRegistry }));
        for (const model of [sales, accounts]) {
            const domainDirectory = path.join(directory, model.domain);
            fs.mkdirSync(domainDirectory);
            const domainManifest = path.join(domainDirectory, 'manifest.json');
            fs.writeFileSync(domainManifest, JSON.stringify(model));
            const validation = spawnSync(process.execPath, [path.join(path.dirname(mergeScriptPath), 'validate-cosmos-model.mjs'), domainManifest, '--reference-manifest', manifestPath, '--check'], { encoding: 'utf8' });
            assert.equal(validation.status, 0, validation.stderr);
        }
        const outputPath = path.join(directory, 'model.json');
        const result = spawnSync(process.execPath, [mergeScriptPath, '--database', mergeOptions.databaseName, '--capacity', mergeOptions.capacityMode, '--manifest', manifestPath, '--output', outputPath, '--input', `Sales=${path.join(directory, 'Sales/manifest.json')}`, '--input', `Accounts=${path.join(directory, 'Accounts/manifest.json')}`], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(validateCosmosModel(JSON.parse(fs.readFileSync(outputPath, 'utf8'))), []);
        assert.deepEqual(fs.readdirSync(directory).sort(), ['Accounts', 'Sales', 'manifest.json', 'model.json']);
    } finally { fs.rmSync(directory, { recursive: true }); }
});

test('does not replace an existing output when the CLI detects a merge conflict', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-model-merge-'));
    const tenantPath = path.join(directory, 'tenant.json');
    const customerPath = path.join(directory, 'customer.json');
    const outputPath = path.join(directory, 'model.json');
    fs.writeFileSync(tenantPath, JSON.stringify(domainModel('Tenant', 'Commerce', entity('Order', 'Sales.Orders'))));
    fs.writeFileSync(
        customerPath,
        JSON.stringify(
            domainModel('Customer', 'Commerce', entity('Customer', 'Sales.Customers', 'customerId'), {
                partitionKey: 'customerId',
            }),
        ),
    );
    fs.writeFileSync(outputPath, '{"existing":true}\n');
    const result = spawnSync(
        process.execPath,
        [
            mergeScriptPath,
            '--database',
            'migration-db',
            '--capacity',
            'serverless',
            '--output',
            outputPath,
            '--input',
            `Tenant=${tenantPath}`,
            '--input',
            `Customer=${customerPath}`,
        ],
        { encoding: 'utf8' },
    );
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), '{"existing":true}\n');
    fs.rmSync(directory, { recursive: true });
});
