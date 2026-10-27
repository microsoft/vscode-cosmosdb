import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBicep } from '../scripts/generate-provisioning-artifacts.mjs';
import {
    modelSha256,
    validateProvisioningVerification,
} from '../scripts/validate-provisioning-verification.mjs';

function inputs() {
    const model = {
        version: 1,
        domain: 'all',
        databaseName: 'migration-db',
        capacityMode: 'serverless',
        containers: [
            {
                name: 'Items',
                partitionKeys: [{ path: '/tenantId' }],
                entities: [
                    {
                        name: 'Item',
                        docType: 'item',
                        sourceTable: 'dbo.Items',
                        idTemplate: 'item-{Id}',
                        attributes: [
                            { target: 'id', source: { table: 'Items', column: 'Id', type: 'int' }, type: 'string', isId: true },
                            { target: 'itemId', source: { table: 'Items', column: 'Id', type: 'int' }, type: 'integer' },
                            { target: 'tenantId', source: { table: 'Items', column: 'TenantId', type: 'varchar' }, type: 'string', isPartitionKey: true },
                        ],
                    },
                ],
                indexingPolicy: { indexingMode: 'consistent', automatic: true, includedPaths: [{ path: '/*' }], excludedPaths: [] },
            },
        ],
    };
    const sampleData = {
        sampleData: [
            { containerName: 'Items', items: [{ id: 'item-1', docType: 'item', itemId: 1, tenantId: 'tenant-1' }] },
        ],
    };
    const project = {
        phases: { targetEnvironment: { type: 'azure', accountName: 'migration-account', endpoint: 'https://migration-account.documents.azure.com/' } },
    };
    const report = {
        version: 1,
        verifiedAt: '2026-09-07T00:00:00.000Z',
        modelSha256: modelSha256(model),
        target: { type: 'azure', accountName: 'migration-account', endpoint: 'https://migration-account.documents.azure.com/' },
        databaseName: 'migration-db',
        containers: [
            {
                name: 'Items',
                partitionKeys: ['/tenantId'],
                indexingPolicy: model.containers[0].indexingPolicy,
                capacityMode: 'serverless',
            },
        ],
        sampleItems: [
            { containerName: 'Items', id: 'item-1', partitionKeyValues: ['tenant-1'], found: true, document: structuredClone(sampleData.sampleData[0].items[0]) },
        ],
        failures: [],
    };
    return { model, sampleData, project, report };
}

function sharedInputs() {
    const values = inputs();
    const { model, project, report } = values;
    model.capacityMode = 'provisioned';
    model.databaseMaxThroughput = 4000;
    model.containers[0].throughputMode = 'shared';
    project.phases.targetEnvironment.capacityMode = 'provisioned';
    report.modelSha256 = modelSha256(model);
    report.databaseThroughput = { mode: 'autoscale', maxThroughput: 4000, isReplacePending: false };
    Object.assign(report.containers[0], { capacityMode: 'provisioned', throughputMode: 'shared', dedicatedThroughputPresent: false });
    return values;
}

test('accepts explicit shared and hybrid allocation readback without rewriting evidence', () => {
    for (const hybrid of [false, true]) {
        const { model, sampleData, project, report } = sharedInputs();
        if (hybrid) {
            const dedicated = structuredClone(model.containers[0]);
            Object.assign(dedicated, { name: 'Dedicated', throughputMode: 'dedicated', maxThroughput: 5000 });
            Object.assign(dedicated.entities[0], { name: 'Dedicated', docType: 'dedicated', idTemplate: 'dedicated-{Id}' });
            model.containers.push(dedicated);
            const document = { ...sampleData.sampleData[0].items[0], id: 'dedicated-1', docType: 'dedicated' };
            sampleData.sampleData.push({ containerName: 'Dedicated', items: [document] });
            report.containers.push({ ...report.containers[0], name: 'Dedicated', throughputMode: 'dedicated',
                dedicatedThroughputPresent: true, maxThroughput: 5000, scalingMode: 'autoscale', isReplacePending: false });
            report.sampleItems.push({ ...report.sampleItems[0], containerName: 'Dedicated', id: 'dedicated-1', document });
            report.modelSha256 = modelSha256(model);
        }
        const original = structuredClone({ model, sampleData, project, report });
        assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
        assert.deepEqual({ model, sampleData, project, report }, original);
        if (hybrid) {
            report.containers[1].isReplacePending = true;
            assert(validateProvisioningVerification(model, sampleData, project, report).some(error => error.path.endsWith('.isReplacePending')));
        }
    }
});

test('rejects missing, mismatched, and pending shared-allocation observations', () => {
    for (const change of [
        report => { report.version = 2; },
        report => { delete report.databaseThroughput; },
        report => { report.databaseThroughput.maxThroughput = 5000; },
        report => { report.databaseThroughput.mode = 'manual'; },
        report => { report.databaseThroughput.isReplacePending = true; },
        report => { delete report.databaseThroughput.isReplacePending; },
        report => { report.containers[0].dedicatedThroughputPresent = true; },
        report => { delete report.containers[0].dedicatedThroughputPresent; },
        report => { report.containers[0].throughputMode = 'dedicated'; },
        report => { delete report.containers[0].throughputMode; },
        report => { report.containers[0].maxThroughput = 4000; },
        report => { report.containers[0].isReplacePending = false; },
        report => { report.containers[0].scalingMode = 'autoscale'; },
    ]) {
        const { model, sampleData, project, report } = sharedInputs();
        change(report);
        assert(validateProvisioningVerification(model, sampleData, project, report).length > 0, change.toString());
    }
    const { model, sampleData, project, report } = sharedInputs();
    delete project.phases.targetEnvironment.capacityMode;
    assert(validateProvisioningVerification(model, sampleData, project, report).some(error => error.path.endsWith('capacityMode')));
});

test('accepts explicit dedicated evidence without managing an unrelated database pool', () => {
    const { model, sampleData, project, report } = sharedInputs();
    delete model.databaseMaxThroughput;
    delete report.databaseThroughput;
    Object.assign(model.containers[0], { throughputMode: 'dedicated', maxThroughput: 4000 });
    Object.assign(report.containers[0], { throughputMode: 'dedicated', maxThroughput: 4000,
        dedicatedThroughputPresent: true, scalingMode: 'autoscale', isReplacePending: false });
    report.modelSha256 = modelSha256(model);
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    for (const field of ['throughputMode', 'dedicatedThroughputPresent', 'scalingMode', 'isReplacePending']) {
        const incomplete = structuredClone(report);
        delete incomplete.containers[0][field];
        assert(validateProvisioningVerification(model, sampleData, project, incomplete)
            .some(error => error.path === `$.containers[0].${field}`));
    }
    report.databaseThroughput = { mode: 'autoscale', maxThroughput: 4000, isReplacePending: false };
    assert(validateProvisioningVerification(model, sampleData, project, report).some(error => error.path === '$.databaseThroughput'));
});

test('accepts exact target and point-read evidence', () => {
    const { model, sampleData, project, report } = inputs();
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
});

for (const targetType of ['azure', 'emulator']) {
    test(`accepts equivalent ${targetType} indexing readback without changing either input`, () => {
        const { model, sampleData, project, report } = inputs();
        if (targetType === 'emulator') {
            project.phases.targetEnvironment = { type: 'emulator', endpoint: 'https://localhost:8081/' };
            report.target = { ...project.phases.targetEnvironment };
            Object.assign(report.containers[0], { capacityMode: 'provisioned', maxThroughput: 1000 });
        }
        model.containers[0].indexingPolicy = {
            indexingMode: 'consistent', automatic: true,
            includedPaths: [{ path: '/tenantId/?' }, { path: '/itemId/?' }],
            excludedPaths: [{ path: '/*' }, { path: '/"_etag"/?' }],
        };
        report.modelSha256 = modelSha256(model);
        const servicePolicy = {
            indexingMode: 'Consistent', automatic: true,
            includedPaths: [{ path: '/"_ts"/?', indexes: [] }, { path: '/itemId/?', indexes: [] }, { path: '/tenantId/?', indexes: [] }],
            excludedPaths: [{ path: '/"_etag"/?', indexes: [] }, { path: '/*', indexes: [] }],
            compositeIndexes: [], spatialIndexes: [], vectorIndexes: [], fullTextIndexes: [],
            supportSpatialLegacyCoordinates: false, usePolygonsSmallerThanAHemisphere: false,
        };
        // Check each representation difference independently as well as the combined SDK/shell readback.
        for (const policy of [
            ...Object.entries(servicePolicy).map(([key, value]) => ({ ...model.containers[0].indexingPolicy, [key]: value })),
            servicePolicy,
        ]) {
            report.containers[0].indexingPolicy = structuredClone(policy);
            const originalModel = structuredClone(model);
            const originalReport = structuredClone(report);
            assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
            assert.deepEqual(model, originalModel);
            assert.deepEqual(report, originalReport);
            assert.equal(modelSha256(model), report.modelSha256);
        }
        const mutations = [
            ['includedPaths', policy => { policy.includedPaths.pop(); }],
            ['includedPaths', policy => { policy.includedPaths.push({ path: '/unexpected/?' }); }],
            ['includedPaths', policy => { policy.includedPaths.push({ path: '/tenantId/?' }); }],
            ['excludedPaths', policy => { policy.excludedPaths.pop(); }],
            ['includedPaths', policy => { policy.includedPaths[1].path = '/ItemId/?'; }],
            ['includedPaths', policy => { policy.includedPaths[0].indexes.push({ kind: 'Range', dataType: 'Number', precision: -1 }); }],
            ['includedPaths', policy => { policy.includedPaths[1].indexes.push({ kind: 'Hash', dataType: 'String', precision: 3 }); }],
            ['excludedPaths', policy => { policy.excludedPaths[0].indexes.push({ kind: 'Range', dataType: 'Number', precision: -1 }); }],
            ['indexingMode', policy => { policy.indexingMode = 'None'; }],
            ['indexingMode', policy => { policy.indexingMode = 'Lazy'; }],
            ['automatic', policy => { policy.automatic = false; }],
            ['compositeIndexes', policy => { policy.compositeIndexes.push([{ path: '/itemId', order: 'ascending' }]); }],
            ['spatialIndexes', policy => { policy.spatialIndexes.push({ path: '/location/*', types: ['Point'] }); }],
            ['vectorIndexes', policy => { policy.vectorIndexes.push({ path: '/embedding', type: 'flat' }); }],
            ['fullTextIndexes', policy => { policy.fullTextIndexes.push({ path: '/text' }); }],
            ['supportSpatialLegacyCoordinates', policy => { policy.supportSpatialLegacyCoordinates = true; }],
            ['usePolygonsSmallerThanAHemisphere', policy => { policy.usePolygonsSmallerThanAHemisphere = true; }],
            ['unrecognizedDefault', policy => { policy.unrecognizedDefault = false; }],
            ['unrecognizedIndexes', policy => { policy.unrecognizedIndexes = []; }],
            ['includedPaths', policy => { policy.includedPaths[0].unrecognizedDefault = false; }],
        ];
        for (const [field, mutate] of mutations) {
            const changed = structuredClone(report);
            mutate(changed.containers[0].indexingPolicy);
            const fields = field === 'indexingMode' ? [field, 'includedPaths'] : [field];
            assert.deepEqual(validateProvisioningVerification(model, sampleData, project, changed), fields.map(name => ({
                path: `$.containers[0].indexingPolicy.${name}`,
                message: 'does not match the model and effective target configuration for container "Items"',
            })), mutate.toString());
        }
    });
}

test('rejects malformed indexing readback rather than treating it as default metadata', () => {
    const { model, sampleData, project, report } = inputs();
    for (const policy of [undefined, null, [], false, 'consistent']) {
        const changed = structuredClone(report);
        changed.containers[0].indexingPolicy = policy;
        assert(validateProvisioningVerification(model, sampleData, project, changed)
            .some(error => error.path === '$.containers[0].indexingPolicy'));
    }
    for (const [field, values] of [
        ['indexingMode', [undefined, null, false, [], 'CONSISTENT', 'consistent ']],
        ['automatic', [undefined, null, 'true', 1]],
        ['includedPaths', [undefined, null, {}, [null], [undefined], [{ path: '/*', indexes: null }]]],
        ['excludedPaths', [undefined, null, false, [null]]],
        ['compositeIndexes', [null, {}, [null], [[]]]],
        ['spatialIndexes', [null, {}, [null]]],
        ['vectorIndexes', [null, {}, [null]]],
        ['fullTextIndexes', [null, {}, [null]]],
        ['supportSpatialLegacyCoordinates', [null, 0, 'false']],
        ['usePolygonsSmallerThanAHemisphere', [null, 0, 'false']],
    ]) {
        for (const value of values) {
            const changed = structuredClone(report);
            changed.containers[0].indexingPolicy[field] = value;
            assert(validateProvisioningVerification(model, sampleData, project, changed)
                .some(error => error.path === `$.containers[0].indexingPolicy.${field}`), `${field}: ${JSON.stringify(value)}`);
        }
    }
});

test('does not ignore timestamp paths outside consistent mode or other system paths', () => {
    const { model, sampleData, project, report } = inputs();
    model.containers[0].indexingPolicy.indexingMode = 'none';
    report.modelSha256 = modelSha256(model);
    report.containers[0].indexingPolicy = structuredClone(model.containers[0].indexingPolicy);
    report.containers[0].indexingPolicy.indexingMode = 'None';
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    report.containers[0].indexingPolicy.includedPaths.push({ path: '/"_ts"/?' });
    assert(validateProvisioningVerification(model, sampleData, project, report)
        .some(error => error.path === '$.containers[0].indexingPolicy.includedPaths'));

    const consistent = inputs();
    for (const path of ['/"_Ts"/?', '/"_etag"/?', '/_ts/*', '/metadata/_ts/?']) {
        const changed = structuredClone(consistent.report);
        changed.containers[0].indexingPolicy.includedPaths.push({ path });
        assert(validateProvisioningVerification(consistent.model, consistent.sampleData, consistent.project, changed)
            .some(error => error.path === '$.containers[0].indexingPolicy.includedPaths'));
    }
});

test('compares composite definitions independently of outer order and known enum casing only', () => {
    const { model, sampleData, project, report } = inputs();
    model.containers[0].indexingPolicy.compositeIndexes = [
        [{ path: '/itemId', order: 'ascending' }, { path: '/tenantId', order: 'descending' }],
        [{ path: '/tenantId', order: 'ascending' }, { path: '/itemId', order: 'ascending' }],
    ];
    report.modelSha256 = modelSha256(model);
    report.containers[0].indexingPolicy = structuredClone(model.containers[0].indexingPolicy);
    report.containers[0].indexingPolicy.compositeIndexes.reverse();
    for (const group of report.containers[0].indexingPolicy.compositeIndexes) {
        for (const entry of group) entry.order = entry.order === 'ascending' ? 'Ascending' : 'Descending';
    }
    const originalModel = structuredClone(model);
    const originalReport = structuredClone(report);
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    assert.deepEqual(model, originalModel);
    assert.deepEqual(report, originalReport);
    for (const mutate of [
        groups => { groups[0].reverse(); },
        groups => { groups[0][0].order = 'Descending'; },
        groups => { groups[0][0].order = 'ASCENDING'; },
        groups => { delete groups[0][0].order; },
        groups => { groups[0][0].path = '/TenantId'; },
        groups => { groups[0][0].extra = false; },
        groups => { groups.pop(); },
        groups => { groups.push(structuredClone(groups[0])); },
        groups => { groups[0] = null; },
        groups => { groups[0][0] = null; },
    ]) {
        const changed = structuredClone(report);
        mutate(changed.containers[0].indexingPolicy.compositeIndexes);
        assert.deepEqual(validateProvisioningVerification(model, sampleData, project, changed), [{
            path: '$.containers[0].indexingPolicy.compositeIndexes',
            message: 'does not match the model and effective target configuration for container "Items"',
        }], mutate.toString());
    }
});

test('compares full-text index membership independently of order without discarding metadata', () => {
    const { model, sampleData, project, report } = inputs();
    model.containers[0].fullTextPolicy = {
        defaultLanguage: 'en-US',
        fullTextPaths: [{ path: '/description', language: 'en-US' }, { path: '/title', language: 'en-US' }],
    };
    model.containers[0].indexingPolicy.fullTextIndexes = [{ path: '/description' }, { path: '/title' }];
    report.modelSha256 = modelSha256(model);
    report.containers[0].fullTextPolicy = structuredClone(model.containers[0].fullTextPolicy);
    report.containers[0].indexingPolicy = structuredClone(model.containers[0].indexingPolicy);
    report.containers[0].indexingPolicy.fullTextIndexes.reverse();
    const original = structuredClone(report);
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    assert.deepEqual(report, original);
    report.containers[0].indexingPolicy.fullTextIndexes[0].extra = false;
    assert(validateProvisioningVerification(model, sampleData, project, report)
        .some(error => error.path === '$.containers[0].indexingPolicy.fullTextIndexes'));
});

test('verifies unique-key readback independent of order without allowing policy drift', () => {
    const { model, sampleData, project, report } = inputs();
    const originalHash = modelSha256(model);
    model.containers[0].uniqueKeyPolicy = {
        uniqueKeys: [{ paths: ['/docType', '/itemId'] }, { paths: ['/id'] }],
    };
    report.modelSha256 = modelSha256(model);
    assert.notEqual(report.modelSha256, originalHash);
    report.containers[0].uniqueKeyPolicy = {
        uniqueKeys: [{ paths: ['/id'] }, { paths: ['/itemId', '/docType'] }],
    };
    const original = structuredClone(report);
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    assert.deepEqual(report, original);
    for (const policy of [undefined, null, { uniqueKeys: [] },
        { uniqueKeys: [{ paths: ['/ItemId', '/docType'] }, { paths: ['/id'] }] },
        { uniqueKeys: [{ paths: ['/id'] }] },
        { uniqueKeys: [{ paths: ['/id'], extra: true }] },
        { uniqueKeys: [{ paths: null }] },
    ]) {
        const changed = structuredClone(report);
        changed.containers[0].uniqueKeyPolicy = policy;
        assert(validateProvisioningVerification(model, sampleData, project, changed)
            .some(error => error.path.startsWith('$.containers')), JSON.stringify(policy));
    }
});

test('accepts empty service unique-key defaults but rejects unexpected constraints', () => {
    const { model, sampleData, project, report } = inputs();
    report.containers[0].uniqueKeyPolicy = { uniqueKeys: [] };
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    report.containers[0].uniqueKeyPolicy.uniqueKeys.push({ paths: ['/id'] });
    assert(validateProvisioningVerification(model, sampleData, project, report)
        .some(error => error.path === '$.containers[0].uniqueKeyPolicy'));
});

test('binds endpoint-only targets and normalizes host casing, default ports, and trailing slashes', () => {
    const { model, sampleData, project, report } = inputs();
    delete project.phases.targetEnvironment.accountName;
    delete report.target.accountName;
    report.target.endpoint = 'https://MIGRATION-ACCOUNT.documents.azure.com:443';
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    for (const endpoint of ['https://wrong.documents.azure.com/', 'https://migration-account.documents.azure.com:444/']) {
        report.target.endpoint = endpoint;
        assert(validateProvisioningVerification(model, sampleData, project, report).some(error => error.path === '$.target.endpoint'));
    }
});

test('requires configured and observed safe endpoints without exposing credentials in errors', () => {
    for (const endpoint of [undefined, '', 'invalid', 'http://account.documents.azure.com',
        'https://user:secret@account.documents.azure.com', 'https://account.documents.azure.com/?token=secret',
        'https://account.documents.azure.com/path', 'https://account.documents.azure.com/#secret']) {
        for (const observed of [true, false]) {
            const { model, sampleData, project, report } = inputs();
            (observed ? report.target : project.phases.targetEnvironment).endpoint = endpoint;
            const errors = validateProvisioningVerification(model, sampleData, project, report);
            assert(errors.some(error => error.path === (observed ? '$.target.endpoint' : '$.project.phases.targetEnvironment.endpoint')));
            assert.doesNotMatch(JSON.stringify(errors), /secret/u);
        }
    }
});

test('accepts emulator HTTP endpoints but keeps different ports and account names distinct', () => {
    const { model, sampleData, project, report } = inputs();
    project.phases.targetEnvironment = { type: 'emulator', endpoint: 'http://localhost:8081/' };
    report.target = { type: 'emulator', endpoint: 'http://LOCALHOST:8081' };
    Object.assign(report.containers[0], { capacityMode: 'provisioned', maxThroughput: 1000 });
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    report.target.endpoint = 'http://localhost:8082';
    assert(validateProvisioningVerification(model, sampleData, project, report).some(error => error.path === '$.target.endpoint'));
    const azure = inputs();
    azure.report.target.accountName = 'different-account';
    assert(validateProvisioningVerification(azure.model, azure.sampleData, azure.project, azure.report).some(error => error.path === '$.target.accountName'));
});

test('requires provisioned emulator observations while preserving the serverless production model', () => {
    const { model, sampleData, project, report } = inputs();
    project.phases.targetEnvironment = { type: 'emulator', endpoint: 'https://localhost:8081/' };
    report.target = { ...project.phases.targetEnvironment };
    const originalModel = structuredClone(model);

    assert(
        validateProvisioningVerification(model, sampleData, project, report)
            .some(error => error.path === '$.containers[0].capacityMode'),
    );
    Object.assign(report.containers[0], { capacityMode: 'provisioned', maxThroughput: 1000 });
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    assert.deepEqual(model, originalModel);
    assert.equal(report.modelSha256, modelSha256(model));

    for (const maxThroughput of [undefined, 2000]) {
        const changed = structuredClone(report);
        changed.containers[0].maxThroughput = maxThroughput;
        assert(
            validateProvisioningVerification(model, sampleData, project, changed)
                .some(error => error.path === '$.containers[0].maxThroughput'),
        );
    }
    const azure = inputs();
    azure.report.containers = report.containers;
    assert(
        validateProvisioningVerification(azure.model, azure.sampleData, azure.project, azure.report)
            .some(error => error.path === '$.containers[0].capacityMode'),
    );
});

test('verifies a serverless model on provisioned Azure without changing its canonical hash', () => {
    const { model, sampleData, project, report } = inputs();
    Object.assign(project.phases.targetEnvironment, { capacityMode: 'provisioned', maxThroughput: 2000 });
    const original = structuredClone(model);
    const originalHash = report.modelSha256;
    Object.assign(report.containers[0], { capacityMode: 'provisioned', maxThroughput: 2000 });
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    assert.deepEqual(model, original);
    assert.equal(modelSha256(model), originalHash);
    for (const change of [{ maxThroughput: 1000 }, { maxThroughput: undefined }, { capacityMode: 'serverless' }]) {
        const changed = structuredClone(report);
        Object.assign(changed.containers[0], change);
        assert(validateProvisioningVerification(model, sampleData, project, changed)
            .some(error => error.path === `$.containers[0].${Object.keys(change)[0]}`));
    }
    delete project.phases.targetEnvironment.maxThroughput;
    assert(validateProvisioningVerification(model, sampleData, project, report)
        .some(error => error.path === '$.project.phases.targetEnvironment'));
});

test('rejects provisioned models on serverless Azure but permits the emulator test exception', () => {
    const { model, sampleData, project, report } = inputs();
    model.capacityMode = 'provisioned';
    model.containers[0].maxThroughput = 4000;
    report.modelSha256 = modelSha256(model);
    project.phases.targetEnvironment.capacityMode = 'serverless';
    assert(validateProvisioningVerification(model, sampleData, project, report)
        .some(error => error.message.includes('cannot satisfy a provisioned-capacity model')));
    project.phases.targetEnvironment = { type: 'emulator', endpoint: 'https://localhost:8081/', capacityMode: 'serverless' };
    report.target = { type: 'emulator', endpoint: 'https://localhost:8081/' };
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    assert.equal(model.capacityMode, 'provisioned');
    assert.equal(model.containers[0].maxThroughput, 4000);
});

test('retains modeled throughput for a provisioned emulator target', () => {
    const { model, sampleData, project, report } = inputs();
    model.capacityMode = 'provisioned';
    model.containers[0].maxThroughput = 4000;
    report.modelSha256 = modelSha256(model);
    project.phases.targetEnvironment = { type: 'emulator', endpoint: 'https://localhost:8081/' };
    report.target = { ...project.phases.targetEnvironment };
    Object.assign(report.containers[0], { capacityMode: 'provisioned', maxThroughput: 4000 });
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
});

test('compares returned content ignoring only top-level service metadata and object key order', () => {
    const { model, sampleData, project, report } = inputs();
    const item = sampleData.sampleData[0].items[0];
    item.details = { _etag: 'user field', values: [1, 2], nullable: null };
    report.sampleItems[0].document = { ...Object.fromEntries(Object.entries(item).reverse()),
        _rid: 'service', _self: 'service', _etag: 'service', _attachments: 'attachments/', _ts: 123, _lsn: 456 };
    const original = structuredClone(report);
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    assert.deepEqual(report, original);
    for (const mutate of [
        document => { document.itemId = 2; },
        document => { document.itemId = '1'; },
        document => { delete document.itemId; },
        document => { document.extra = true; },
        document => { document.details = { ...document.details, _etag: 'changed user field' }; },
        document => { document.details = { ...document.details, values: [2, 1] }; },
        document => { document.id = 'wrong'; },
        document => { document.tenantId = 'wrong'; },
    ]) {
        const changed = structuredClone(report);
        mutate(changed.sampleItems[0].document);
        assert(validateProvisioningVerification(model, sampleData, project, changed).some(error => error.path === '$.sampleItems[0].document'));
    }
    delete report.sampleItems[0].document;
    assert(validateProvisioningVerification(model, sampleData, project, report).some(error => error.path === '$.sampleItems[0].document'));
});

test('requires complete unique observations and object-valued readback bodies', () => {
    for (const mutate of [
        report => { report.sampleItems = []; },
        report => { report.sampleItems.push(structuredClone(report.sampleItems[0])); },
        report => { report.sampleItems[0].id = 'other'; },
        report => { report.sampleItems[0].containerName = 'Other'; },
        report => { report.sampleItems[0].partitionKeyValues = ['wrong']; },
        report => { report.sampleItems[0].found = false; },
    ]) {
        const { model, sampleData, project, report } = inputs();
        mutate(report);
        assert(validateProvisioningVerification(model, sampleData, project, report).some(error => error.path === '$.sampleItems'));
    }
    for (const document of [undefined, null, [], 'text', 1]) {
        const { model, sampleData, project, report } = inputs();
        report.sampleItems[0].document = document;
        assert(validateProvisioningVerification(model, sampleData, project, report).some(error => error.path === '$.sampleItems[0].document'));
    }
});

test('compares nulls and precision-sensitive strings without coercion', () => {
    const { model, sampleData, project, report } = inputs();
    Object.assign(sampleData.sampleData[0].items[0], {
        exact: '9007199254740993', amount: '99999999999999.99', nullable: null,
    });
    report.sampleItems[0].document = structuredClone(sampleData.sampleData[0].items[0]);
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    for (const change of [
        { exact: Number('9007199254740993') }, { amount: 99999999999999.99 },
        { nullable: 'null' }, { _custom: 'not service metadata' },
    ]) {
        const changed = structuredClone(report);
        Object.assign(changed.sampleItems[0].document, change);
        assert(validateProvisioningVerification(model, sampleData, project, changed).some(error => error.path === '$.sampleItems[0].document'));
    }
});

test('requires endpoint and document evidence without modifying the report', () => {
    const { model, sampleData, project, report } = inputs();
    delete report.target.endpoint;
    delete report.sampleItems[0].document;
    const original = structuredClone(report);
    const errors = validateProvisioningVerification(model, sampleData, project, report);
    assert(errors.some(error => error.path === '$.target.endpoint'));
    assert(errors.some(error => error.path === '$.sampleItems[0].document'));
    assert.deepEqual(report, original);
});

test('verifies emitted indexing defaults without changing the model or observations', () => {
    for (const omittedFields of [['indexingMode'], ['automatic'], ['indexingMode', 'automatic']]) {
        const { model, sampleData, project, report } = inputs();
        report.containers[0].indexingPolicy = structuredClone(model.containers[0].indexingPolicy);
        for (const field of omittedFields) delete model.containers[0].indexingPolicy[field];
        report.modelSha256 = modelSha256(model);
        const originalModel = structuredClone(model);
        const originalReport = structuredClone(report);
        const bicep = buildBicep(model, project.phases.targetEnvironment);
        assert.match(bicep, /indexingMode: 'consistent'/u);
        assert.match(bicep, /automatic: true/u);
        assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
        assert.deepEqual(model, originalModel);
        assert.deepEqual(report, originalReport);
        assert.equal(modelSha256(model), report.modelSha256);
    }
});

test('preserves explicit indexing settings and rejects drift from their effective values', () => {
    for (const [indexingMode, automatic] of [[undefined, false], ['none', undefined], ['none', false]]) {
        const { model, sampleData, project, report } = inputs();
        Object.assign(model.containers[0].indexingPolicy, { indexingMode, automatic });
        const effectivePolicy = {
            ...model.containers[0].indexingPolicy,
            indexingMode: indexingMode ?? 'consistent',
            automatic: automatic ?? true,
        };
        report.containers[0].indexingPolicy = effectivePolicy;
        report.modelSha256 = modelSha256(model);
        const bicep = buildBicep(model, project.phases.targetEnvironment);
        assert(bicep.includes(`indexingMode: '${effectivePolicy.indexingMode}'`));
        assert(bicep.includes(`automatic: ${effectivePolicy.automatic}`));
        assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
        for (const change of [
            { indexingMode: effectivePolicy.indexingMode === 'none' ? 'consistent' : 'none' },
            { automatic: !effectivePolicy.automatic },
        ]) {
            const observed = structuredClone(report);
            Object.assign(observed.containers[0].indexingPolicy, change);
            assert(
                validateProvisioningVerification(model, sampleData, project, observed)
                    .some(error => error.path === `$.containers[0].indexingPolicy.${Object.keys(change)[0]}`),
            );
        }
    }
});

test('does not infer missing observations or accept drift when model defaults are omitted', () => {
    const { model, sampleData, project, report } = inputs();
    report.containers[0].indexingPolicy = structuredClone(model.containers[0].indexingPolicy);
    delete model.containers[0].indexingPolicy.indexingMode;
    delete model.containers[0].indexingPolicy.automatic;
    report.modelSha256 = modelSha256(model);
    for (const change of [
        { indexingMode: 'none' },
        { automatic: false },
        { indexingMode: undefined },
        { automatic: undefined },
        { indexingMode: null },
        { automatic: null },
    ]) {
        const observed = structuredClone(report);
        Object.assign(observed.containers[0].indexingPolicy, change);
        assert(
            validateProvisioningVerification(model, sampleData, project, observed)
                .some(error => error.path === `$.containers[0].indexingPolicy.${Object.keys(change)[0]}`),
        );
    }
});

test('verifies full-text policies and indexes and rejects missing or changed readback', () => {
    const { model, sampleData, project, report } = inputs();
    model.containers[0].fullTextPolicy = {
        defaultLanguage: 'en-US',
        fullTextPaths: [{ path: '/description', language: 'en-US' }],
    };
    model.containers[0].indexingPolicy.fullTextIndexes = [{ path: '/description' }];
    report.containers[0].fullTextPolicy = structuredClone(model.containers[0].fullTextPolicy);
    report.modelSha256 = modelSha256(model);
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
    const mutations = [
        (container) => {
            delete container.fullTextPolicy;
        },
        (container) => {
            container.fullTextPolicy.fullTextPaths[0].language = 'de-DE';
        },
        (container) => {
            container.fullTextPolicy.defaultLanguage = 'fr-FR';
        },
        (container) => {
            delete container.indexingPolicy.fullTextIndexes;
        },
        (container) => {
            container.indexingPolicy.fullTextIndexes[0].path = '/title';
        },
    ];
    for (const mutate of mutations) {
        const observed = structuredClone(report);
        mutate(observed.containers[0]);
        assert(
            validateProvisioningVerification(model, sampleData, project, observed).some(
                (error) => error.path.startsWith('$.containers[0].'),
            ),
        );
    }
});

test('rejects stale model hashes and container drift', () => {
    const { model, sampleData, project, report } = inputs();
    report.modelSha256 = '0'.repeat(64);
    report.containers[0].partitionKeys = ['/wrong'];
    const errors = validateProvisioningVerification(model, sampleData, project, report);
    assert(errors.some((error) => error.path === '$.modelSha256'));
    assert(errors.some((error) => error.path === '$.containers[0].partitionKeys'));
});

test('identifies missing, duplicate, unexpected and malformed container observations', () => {
    const { model, sampleData, project, report } = inputs();
    for (const [containers, diagnosticPath, message] of [
        [undefined, '$.containers', 'must be an array'],
        [null, '$.containers', 'must be an array'],
        [[], '$.containers', 'missing readback for modeled container "Items"'],
        [[null], '$.containers[0]', 'must be an object'],
        [[{}], '$.containers[0].name', 'must be a nonempty container name'],
        [[{ name: 1 }], '$.containers[0].name', 'must be a nonempty container name'],
        [[{ name: '' }], '$.containers[0].name', 'must be a nonempty container name'],
        [[report.containers[0], structuredClone(report.containers[0])],
            '$.containers[1].name', 'duplicates readback for container "Items"'],
        [[report.containers[0], { ...report.containers[0], name: 'Other' }],
            '$.containers[1].name', 'is not a modeled container: "Other"'],
        [[{ ...report.containers[0], name: 'items' }], '$.containers[0].name', 'is not a modeled container: "items"'],
        [[{ ...report.containers[0], extra: false }], '$.containers[0].extra', 'is not allowed'],
    ]) {
        const changed = { ...report, containers };
        const original = structuredClone(changed);
        assert(validateProvisioningVerification(model, sampleData, project, changed)
            .some(error => error.path === diagnosticPath && error.message === message), message);
        assert.deepEqual(changed, original);
    }
});

test('requires every point-read and no failures', () => {
    const { model, sampleData, project, report } = inputs();
    report.sampleItems[0].found = false;
    report.failures.push({ operation: 'upsert', resource: 'Items/item-1', code: '429' });
    const errors = validateProvisioningVerification(model, sampleData, project, report);
    assert(errors.some((error) => error.path === '$.sampleItems'));
    assert(errors.some((error) => error.path === '$.failures'));
});

test('accepts observed containers and point reads in any order', () => {
    const { model, sampleData, project, report } = inputs();
    report.containers.push({ ...report.containers[0], name: 'Other' });
    const otherEntity = structuredClone(model.containers[0].entities[0]);
    otherEntity.name = 'OtherItem';
    otherEntity.docType = 'other';
    otherEntity.sourceTable = 'dbo.OtherItems';
    otherEntity.idTemplate = 'otherItem-{Id}';
    for (const attribute of otherEntity.attributes) attribute.source.table = 'OtherItems';
    model.containers.push({
        ...model.containers[0],
        name: 'Other',
        entities: [otherEntity],
    });
    sampleData.sampleData.push({
        containerName: 'Other',
        items: [{ id: 'otherItem-2', docType: 'other', itemId: 2, tenantId: 'tenant-2' }],
    });
    report.modelSha256 = modelSha256(model);
    report.containers[1].indexingPolicy = model.containers[1].indexingPolicy;
    report.sampleItems.push({
        containerName: 'Other',
        id: 'otherItem-2',
        partitionKeyValues: ['tenant-2'],
        found: true,
        document: structuredClone(sampleData.sampleData[1].items[0]),
    });
    report.containers.reverse();
    report.sampleItems.reverse();
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);

    const changed = structuredClone(report);
    changed.containers[0].indexingPolicy = { ...changed.containers[0].indexingPolicy, automatic: false };
    changed.containers[1].partitionKeys = ['/wrong'];
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, changed), [
        {
            path: '$.containers[0].indexingPolicy.automatic',
            message: 'does not match the model and effective target configuration for container "Other"',
        },
        {
            path: '$.containers[1].partitionKeys',
            message: 'does not match the model and effective target configuration for container "Items"',
        },
    ]);
});
