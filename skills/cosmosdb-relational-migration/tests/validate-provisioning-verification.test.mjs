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

test('accepts exact target and point-read evidence', () => {
    const { model, sampleData, project, report } = inputs();
    assert.deepEqual(validateProvisioningVerification(model, sampleData, project, report), []);
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
        .some(error => error.path === '$.containers'));
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
            .some(error => error.path === '$.containers'),
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
                .some(error => error.path === '$.containers'),
        );
    }
    const azure = inputs();
    azure.report.containers = report.containers;
    assert(
        validateProvisioningVerification(azure.model, azure.sampleData, azure.project, azure.report)
            .some(error => error.path === '$.containers'),
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
        assert(validateProvisioningVerification(model, sampleData, project, changed).some(error => error.path === '$.containers'));
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
                    .some(error => error.path === '$.containers'),
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
                .some(error => error.path === '$.containers'),
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
                (error) => error.path === '$.containers',
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
    assert(errors.some((error) => error.path === '$.containers'));
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
});
