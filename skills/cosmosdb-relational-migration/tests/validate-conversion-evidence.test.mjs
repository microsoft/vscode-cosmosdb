import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCosmosModels } from '../scripts/merge-cosmos-models.mjs';
import { modelHash, validateConversionEvidence } from '../scripts/validate-conversion-evidence.mjs';

function fixture() {
    const model = { version: 1, domain: 'Orders', containers: [{ name: 'Orders', partitionKeys: [{ path: '/pk' }], indexingPolicy: { includedPaths: [{ path: '/*' }], excludedPaths: [] }, entities: [{ name: 'Order', docType: 'order', sourceTable: 'public.orders', idTemplate: 'order-{id}', attributes: [
        { target: 'id', source: { table: 'public.orders', column: 'id', type: 'int' }, type: 'string', isId: true },
        { target: 'orderId', source: { table: 'public.orders', column: 'id', type: 'int' }, type: 'number' },
        { target: 'pk', source: { table: 'public.orders', column: 'pk', type: 'text' }, type: 'string', isPartitionKey: true },
    ] }] }] };
    const domainModels = [{ domainName: 'Orders', model }];
    const inventory = { sha256: 'source', dialect: 'postgres', tables: [{ name: 'public.orders', identity: [{ name: 'public' }, { name: 'orders' }], columns: [{ name: 'id' }, { name: 'pk' }], primaryKey: ['id'], foreignKeys: [] }] };
    const project = { version: 1, name: 'app', sourceCode: 'parent', phases: { discovery: { status: 'complete' }, assessment: { status: 'complete', domains: [{ name: 'Orders', tables: ['public.orders'], isMapped: true, estimatedTokens: 1, crossDomainDependencies: [] }] }, schemaConversion: { status: 'complete', domains: ['Orders'] } } };
    const evidence = { version: 1, sourceSha256: 'source', includeUnmappedDomains: false, domainSha256: { Orders: modelHash(model) }, databaseName: 'app', capacityMode: 'serverless', blockingIssues: [] };
    return { project, inventory, domainModels, evidence, root: mergeCosmosModels(domainModels, evidence).model };
}

function validateUpdatedModels(value) {
    for (const { domainName, model } of value.domainModels) value.evidence.domainSha256[domainName] = modelHash(model);
    value.root = mergeCosmosModels(value.domainModels, value.evidence).model;
    return validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence);
}

test('binds selected domains, source ownership and root bytes to accepted inputs', () => {
    const { project, inventory, domainModels, evidence, root } = fixture();
    assert.deepEqual(validateConversionEvidence(project, inventory, domainModels, root, evidence), []);
    root.containers[0].name = 'Different';
    assert(validateConversionEvidence(project, inventory, domainModels, root, evidence).some(error => /deterministic merge/.test(error.message)));
});

test('accepts design decisions without bypassing concrete conversion failures', () => {
    const value = fixture();
    value.evidence.blockingIssues = [{ kind: 'design-decision', message: 'Review the capacity estimate before deployment.' }];
    const original = structuredClone(value.evidence);
    assert.deepEqual(validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence), []);
    assert.deepEqual(value.evidence, original);
    value.inventory.tables[0].columns.push({ name: 'amount' });
    assert(validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence)
        .some(error => error.message.includes('Authoritative target omits source column')));
});

test('rejects evidenced terminal failures and unclassified conversion issues', () => {
    for (const issue of [
        { kind: 'data-loss', message: 'The conversion truncates values.', evidence: ['summary.md#validation'] },
        'Resolve mapping.',
    ]) {
        const value = fixture();
        value.evidence.blockingIssues = [issue];
        assert(validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence)
            .some(error => /terminal|reclassify/u.test(error.message)));
    }
});

test('rejects omitted selected domains, missing source columns and stale input hashes', () => {
    for (const mutate of [
        value => { value.project.phases.assessment.domains.push({ name: 'Missing', tables: ['missing'], isMapped: true, estimatedTokens: 1, crossDomainDependencies: [] }); },
        value => { value.inventory.tables[0].columns = []; },
        value => { value.evidence.domainSha256.Orders = 'stale'; },
    ]) {
        const value = fixture(); mutate(value);
        assert(validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence).length);
    }
});

test('rejects unmapped source columns with the qualified source identity', () => {
    const value = fixture();
    value.inventory.tables[0].columns.push({ name: 'amount' });
    const errors = validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence);
    assert(errors.some(error => error.message.includes('public.orders.amount')));
});

test('binds relationship source-FK tables and columns to the selected source inventory', () => {
    const value = fixture();
    const entity = value.domainModels[0].model.containers[0].entities[0];
    entity.relationships = [{
        targetEntity: 'Order',
        sourceFK: { table: 'public.orders', column: 'missing' },
        type: 'one-to-one',
        strategy: 'reference',
    }];
    let errors = validateUpdatedModels(value);
    assert(errors.some(error => error.message.includes('public.orders.missing')));

    entity.relationships[0].sourceFK.column = 'id';
    value.inventory.tables[0].foreignKeys = [{
        columns: ['id'],
        referencedTable: 'public.orders',
        referencedColumns: ['id'],
    }];
    assert.deepEqual(validateUpdatedModels(value), []);

    entity.relationships[0].sourceFK.table = 'missing.orders';
    errors = validateUpdatedModels(value);
    assert(errors.some(error => error.message.includes('missing.orders')));
});

test('requires every composite primary-key component in the standalone ID template', () => {
    const value = fixture();
    const table = value.inventory.tables[0];
    table.columns.push({ name: 'lineNo' });
    table.primaryKey.push('lineNo');
    const model = value.domainModels[0].model;
    const entity = model.containers[0].entities[0];
    entity.attributes.push({ target: 'lineNo', source: { table: 'public.orders', column: 'lineNo', type: 'int' }, type: 'number' });
    value.evidence.domainSha256.Orders = modelHash(model);
    value.root = mergeCosmosModels(value.domainModels, value.evidence).model;
    let errors = validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence);
    assert(errors.some(error => error.message.includes('idTemplate') && error.message.includes('public.orders.lineNo')));

    entity.idTemplate = 'order-{id}-{lineNo}';
    value.evidence.domainSha256.Orders = modelHash(model);
    value.root = mergeCosmosModels(value.domainModels, value.evidence).model;
    errors = validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence);
    assert.deepEqual(errors, []);
});

test('accepts all-UUID and mixed composite keys but still rejects either omitted primary-key component', () => {
    for (const secondType of ['uuid', 'int']) {
        const value = fixture();
        const table = value.inventory.tables[0];
        table.columns.push({ name: 'lineNo' });
        table.primaryKey.push('lineNo');
        const entity = value.domainModels[0].model.containers[0].entities[0];
        const naturalKey = entity.attributes.find(attribute => attribute.target === 'orderId');
        naturalKey.source.type = 'uuid';
        naturalKey.type = 'string';
        const secondKey = { target: 'lineNo', source: { table: 'public.orders', column: 'lineNo', type: secondType }, type: secondType === 'uuid' ? 'string' : 'number' };
        entity.attributes.push(secondKey);
        const idAttribute = entity.attributes.find(attribute => attribute.isId);
        entity.idTemplate = 'order-{id}-{lineNo}';
        for (const keyAttribute of [naturalKey, secondKey]) {
            idAttribute.source = { ...keyAttribute.source };
            assert.deepEqual(validateUpdatedModels(value), []);
        }

        idAttribute.source = { ...naturalKey.source };
        entity.idTemplate = '{id}';
        assert(validateUpdatedModels(value).some(error => error.message.includes('idTemplate omits source primary-key column: public.orders.lineNo')));
        idAttribute.source = { ...secondKey.source };
        entity.idTemplate = secondType === 'uuid' ? '{lineNo}' : 'order-{lineNo}';
        assert(validateUpdatedModels(value).some(error => error.message.includes('idTemplate omits source primary-key column: public.orders.id')));
    }
});

test('does not let a projection supply columns missing from the authoritative target', () => {
    const value = fixture();
    const model = value.domainModels[0].model;
    const entity = model.containers[0].entities[0];
    const projection = structuredClone(model.containers[0]);
    projection.name = 'OrderLookup';
    projection.entities[0].name = 'OrderLookup';
    projection.entities[0].docType = 'orderLookup';
    projection.entities[0].idTemplate = 'orderLookup-{id}';
    model.containers.push(projection);
    value.evidence.sourceDispositions = [{ sourceTable: 'public.orders', domain: 'Orders', targets: [
        { domain: 'Orders', container: 'Orders', entity: 'Order', kind: 'authoritative' },
        { domain: 'Orders', container: 'OrderLookup', entity: 'OrderLookup', kind: 'projection' },
    ] }];
    value.inventory.tables[0].columns.push({ name: 'amount' });
    const amount = { target: 'amount', source: { table: 'public.orders', column: 'amount', type: 'decimal' }, type: 'number' };
    entity.attributes.push(amount);
    assert.deepEqual(validateUpdatedModels(value), []);

    entity.attributes.pop();
    projection.entities[0].attributes.push(amount);
    assert(validateUpdatedModels(value).some(error => error.message.includes('public.orders.amount')));
});

test('validates each consolidated source independently without changing the owner ID', () => {
    const value = fixture();
    value.inventory.tables.push({ name: 'public.details', identity: [{ name: 'public' }, { name: 'details' }], columns: [{ name: 'detailId' }, { name: 'amount' }], primaryKey: ['detailId'] });
    value.project.phases.assessment.domains[0].tables.push('public.details');
    const entity = value.domainModels[0].model.containers[0].entities[0];
    entity.attributes.push({ target: 'detailId', source: { table: 'public.details', column: 'detailId', type: 'int' }, type: 'number' });
    const amount = { target: 'amount', source: { table: 'public.details', column: 'amount', type: 'decimal' }, type: 'number' };
    entity.attributes.push(amount);
    value.evidence.sourceDispositions = [
        { sourceTable: 'public.orders', domain: 'Orders', targets: [{ domain: 'Orders', container: 'Orders', entity: 'Order', kind: 'authoritative' }] },
        { sourceTable: 'public.details', domain: 'Orders', targets: [{ domain: 'Orders', container: 'Orders', entity: 'Order', kind: 'consolidated' }] },
    ];
    assert.deepEqual(validateUpdatedModels(value), []);

    value.inventory.tables[0].columns.push({ name: 'amount' });
    amount.source.table = 'public.orders';
    assert(validateUpdatedModels(value).some(error => error.message.includes('public.details.amount')));
});

test('does not use another source table to preserve a natural primary key', () => {
    const value = fixture();
    const table = structuredClone(value.inventory.tables[0]);
    table.name = 'archive.orders';
    table.identity[0].name = 'archive';
    value.inventory.tables.push(table);
    value.project.phases.assessment.domains[0].tables.push(table.name);
    const container = value.domainModels[0].model.containers[0];
    const archived = structuredClone(container.entities[0]);
    archived.name = 'ArchivedOrder';
    archived.docType = 'archivedOrder';
    archived.sourceTable = table.name;
    archived.idTemplate = 'archivedOrder-{id}';
    for (const attribute of archived.attributes) attribute.source.table = table.name;
    container.entities.push(archived);
    assert.deepEqual(validateUpdatedModels(value), []);

    container.entities[0].attributes.find(attribute => attribute.target === 'orderId').source.table = table.name;
    assert(validateUpdatedModels(value).some(error => error.message.includes('preserved separately: public.orders.id')));
});

test('preserves embedded primary keys without requiring standalone ID templates', () => {
    const value = fixture();
    value.inventory.tables.push({ name: 'public.lines', identity: [{ name: 'public' }, { name: 'lines' }], columns: [{ name: 'lineId' }, { name: 'orderId' }], primaryKey: ['lineId'], foreignKeys: [{ columns: ['orderId'], referencedTable: 'public.orders', referencedColumns: ['id'] }] });
    value.project.phases.assessment.domains[0].tables.push('public.lines');
    const container = value.domainModels[0].model.containers[0];
    const embedded = { name: 'OrderLine', docType: 'orderLine', sourceTable: 'public.lines', isEmbeddedOnly: true, attributes: [
        { target: 'id', source: { table: 'public.lines', column: 'lineId', type: 'int' }, type: 'number' },
        { target: 'orderId', source: { table: 'public.lines', column: 'orderId', type: 'int' }, type: 'number' },
    ] };
    container.entities.push(embedded);
    container.entities[0].relationships = [{ targetEntity: 'OrderLine', sourceFK: { table: 'public.lines', column: 'orderId' }, type: 'one-to-many', strategy: 'embed', targetProperty: 'lines' }];
    assert.deepEqual(validateUpdatedModels(value), []);

    embedded.attributes.pop();
    assert(validateUpdatedModels(value).some(error => error.message.includes('public.lines.orderId')));
});

test('preserves keyless source columns with the generated UUID fallback', () => {
    const value = fixture();
    value.inventory.tables[0].primaryKey = [];
    const entity = value.domainModels[0].model.containers[0].entities[0];
    entity.idTemplate = '{uuid}';
    entity.attributes.find(attribute => attribute.isId).source = { table: '(generated)', column: '(uuid)', type: 'uuid' };
    assert.deepEqual(validateUpdatedModels(value), []);

    entity.attributes = entity.attributes.filter(attribute => attribute.target !== 'orderId');
    assert(validateUpdatedModels(value).some(error => error.message.includes('public.orders.id')));
});

test('accepts owned projections but rejects duplicate authoritative dispositions', () => {
    const value = fixture();
    const model = value.domainModels[0].model;
    const projection = structuredClone(model.containers[0]);
    projection.name = 'OrderLookup';
    projection.entities[0].name = 'OrderLookup';
    projection.entities[0].docType = 'orderLookup';
    projection.entities[0].idTemplate = 'orderLookup-{id}';
    model.containers.push(projection);
    value.evidence.domainSha256.Orders = modelHash(model);
    value.root = mergeCosmosModels(value.domainModels, value.evidence).model;
    assert(validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence).length);
    value.evidence.sourceDispositions = [{ sourceTable: 'public.orders', domain: 'Orders', targets: [
        { domain: 'Orders', container: 'Orders', entity: 'Order', kind: 'authoritative' },
        { domain: 'Orders', container: 'OrderLookup', entity: 'OrderLookup', kind: 'projection' },
    ] }];
    assert.deepEqual(validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence), []);
    value.evidence.sourceDispositions[0].targets[1].kind = 'authoritative';
    assert(validateConversionEvidence(value.project, value.inventory, value.domainModels, value.root, value.evidence).some(error => /exactly one authoritative/.test(error.message)));
});
