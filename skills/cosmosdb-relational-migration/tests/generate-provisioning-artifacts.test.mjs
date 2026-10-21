import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    buildBicep,
    buildProvisioningArtifacts,
    checkSeedShell,
    getProvisioningCapacity,
    runCli,
    validateProvisioningArtifacts,
} from '../scripts/generate-provisioning-artifacts.mjs';

function inputs() {
    const model = {
        version: 1,
        domain: 'all',
        databaseName: 'migration-db',
        capacityMode: 'provisioned',
        containers: [
            {
                name: 'Items',
                partitionKeys: [{ path: '/tenantId' }, { path: '/itemId' }],
                entities: [
                    {
                        name: 'Item',
                        docType: 'item',
                        sourceTable: 'dbo.Items',
                        idTemplate: 'item-{Id}',
                        attributes: [
                            { target: 'id', source: { table: 'Items', column: 'Id', type: 'int' }, type: 'string', isId: true },
                            { target: 'itemId', source: { table: 'Items', column: 'Id', type: 'int' }, type: 'integer', isPartitionKey: true },
                            { target: 'tenantId', source: { table: 'Items', column: 'TenantId', type: 'varchar' }, type: 'string', isPartitionKey: true },
                        ],
                    },
                ],
                indexingPolicy: {
                    indexingMode: 'consistent',
                    automatic: true,
                    includedPaths: [{ path: '/*' }],
                    excludedPaths: [],
                },
                maxThroughput: 4000,
            },
        ],
    };
    const sampleData = {
        sampleData: [
            {
                containerName: 'Items',
                items: [{ id: 'item-1', docType: 'item', itemId: 1, tenantId: 'tenant-1' }],
            },
        ],
    };
    const project = {
        version: 1,
        name: 'migration-app',
        sourceCode: 'parent',
        phases: {
            discovery: { status: 'complete' },
            targetEnvironment: { type: 'provision', accountName: 'migration-account', location: 'eastus' },
        },
    };
    return { model, sampleData, project };
}

test('Azure seeding never replays Bicep resource operations', () => {
    const { model, sampleData, project } = inputs();
    for (const type of ['azure', 'provision']) {
        for (const capacityMode of ['serverless', 'provisioned']) {
            project.phases.targetEnvironment = {
                type, accountName: 'migration-account', location: 'eastus',
                subscriptionId: 'subscription-id', resourceGroup: 'migration-group',
            };
            model.capacityMode = capacityMode;
            if (capacityMode === 'serverless') delete model.containers[0].maxThroughput;
            else model.containers[0].maxThroughput = 4000;
            const original = structuredClone({ model, sampleData, project });
            const artifacts = buildProvisioningArtifacts(model, sampleData, project);
            const seed = artifacts['seed-data.csh'];
            assert.doesNotMatch(seed, /^(?:create|index|throughput|rm|delete)\b/mu);
            assert.match(seed, /^connect \$1 --subscription=subscription-id --resource-group=migration-group$/mu);
            assert.match(seed, /\$data = \(cat \$2\)/u);
            assert.match(seed, /mkitem --database=migration-db --container=\$entry.containerName --upsert/u);
            assert.match(artifacts['main.bicep'], /version: 2/u);
            assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
            assert.deepEqual({ model, sampleData, project }, original);
        }
    }
});

test('generates model-aligned Bicep, parameters, and seed script', () => {
    const { model, sampleData, project } = inputs();
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);
    assert.match(artifacts['main.bicep'], /resource account '[^']+' = \{/u);
    assert.match(artifacts['main.bicep'], /disableLocalAuth: true/u);
    assert.match(artifacts['main.bicep'], /resource dataContributorAssignment/u);
    assert.doesNotMatch(artifacts['main.bicep'], /EnableServerless/u);
    assert.match(artifacts['main.bicep'], /paths: \['\/tenantId', '\/itemId'\]/u);
    assert.match(artifacts['main.bicep'], /maxThroughput: 4000/u);
    assert.match(artifacts['main.bicepparam'], /migration-account/u);
    assert.match(artifacts['main.bicepparam'], /param location = 'eastus'/u);
    assert.doesNotMatch(artifacts['seed-data.csh'], /^(?:create|index|throughput)\b/mu);
    assert.match(artifacts['seed-data.csh'], /^connect \$1$/mu);
    assert.match(artifacts['seed-data.csh'], /mkitem --database=migration-db --container=\$entry.containerName --upsert/u);
    assert.doesNotMatch(artifacts['seed-data.csh'], /--max_throughput/u);
    assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
});

test('passes saved ARM coordinates for Azure targets without changing emulator connections', () => {
    const { model, sampleData, project } = inputs();
    for (const type of ['azure', 'provision', 'emulator']) {
        project.phases.targetEnvironment = {
            type, endpoint: 'https://account.documents.azure.com/',
            subscriptionId: 'subscription-id', resourceGroup: 'migration(test)',
        };
        const original = structuredClone(project);
        const artifacts = buildProvisioningArtifacts(model, sampleData, project);
        const connection = artifacts['seed-data.csh'].split('\n').find(line => line.startsWith('connect '));
        assert.equal(connection, type === 'emulator'
            ? 'connect $1'
            : 'connect $1 --subscription=subscription-id --resource-group="migration(test)"');
        assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
        assert.deepEqual(project, original);
        if (type !== 'emulator') {
            artifacts['seed-data.csh'] = artifacts['seed-data.csh'].replace(connection, 'connect $1');
            assert(validateProvisioningArtifacts(artifacts, model, sampleData, project)
                .some(error => error.path === '$.seed-data.csh'));
        }
    }
});

test('requires supported target types while preserving precise strings and explicit nulls during generation', () => {
    const { model, sampleData, project } = inputs();
    const baseline = buildProvisioningArtifacts(model, sampleData, project);
    const attribute = { target: 'amount', source: { table: 'Items', column: 'Amount', type: 'decimal(38,18)' }, type: 'decimal' };
    model.containers[0].entities[0].attributes.push(attribute);
    sampleData.sampleData[0].items[0].amount = '99999999999999999999.123456789012345678';
    assert.throws(() => buildProvisioningArtifacts(model, sampleData, project), /supported target JSON type/u);
    attribute.type = 'string';
    model.containers[0].entities[0].attributes.push({
        target: 'placeholder', source: { table: 'Items', column: 'Placeholder', type: 'varchar' }, type: 'null',
    });
    sampleData.sampleData[0].items[0].placeholder = null;
    const original = structuredClone(sampleData);
    assert.deepEqual(buildProvisioningArtifacts(model, sampleData, project), baseline);
    assert.deepEqual(sampleData, original);
});

test('reuses generated UUIDs persisted in sample data without identity assignments', () => {
    const { model, sampleData, project } = inputs();
    const entity = model.containers[0].entities[0];
    entity.idTemplate = '{uuid}';
    entity.attributes.find(attribute => attribute.isId).source = {
        table: '(generated)',
        column: '(uuid)',
        type: 'uuid',
    };
    sampleData.sampleData[0].items[0].id = 'c56a4180-65aa-42ec-a945-5fd21dec0538';
    const original = structuredClone(sampleData);

    const first = buildProvisioningArtifacts(model, sampleData, project);
    const second = buildProvisioningArtifacts(model, sampleData, project);
    assert.deepEqual(second, first);
    assert.deepEqual(sampleData, original);
});

test('preserves _etag exclusions in artifacts and rejects explicitly indexed _etag models', () => {
    const { model, sampleData, project } = inputs();
    model.containers[0].indexingPolicy.excludedPaths = [{ path: '/"_etag"/?' }];
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);
    assert(artifacts['main.bicep'].includes('path: \'/"_etag"/?\''));
    assert.doesNotMatch(artifacts['seed-data.csh'], /^index /mu);
    assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
    model.containers[0].indexingPolicy.includedPaths.push({ path: '/_etag/?' });
    assert.throws(() => buildProvisioningArtifacts(model, sampleData, project), /must not explicitly index/u);
    const errors = validateProvisioningArtifacts(artifacts, model, sampleData, project);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /must not explicitly index/u);
});

test('rejects service-invalid root id indexes before generating provisioning artifacts', () => {
    const { model, sampleData, project } = inputs();
    model.containers[0].indexingPolicy.includedPaths.push({ path: '/id/?' });
    assert.throws(() => buildProvisioningArtifacts(model, sampleData, project), /system id/u);
});

test('emits container-level full-text policy and indexing-policy full-text indexes', () => {
    const { model, project } = inputs();
    model.containers[0].fullTextPolicy = {
        defaultLanguage: 'en-US',
        fullTextPaths: [{ path: '/description', language: 'en-US' }],
    };
    model.containers[0].indexingPolicy.fullTextIndexes = [{ path: '/description' }];
    const bicep = buildBicep(model, project.phases.targetEnvironment);
    assert.match(bicep, /sqlDatabases\/containers@2025-10-15/u);
    assert.match(bicep, /^      fullTextPolicy: \{\n        defaultLanguage: 'en-US'/mu);
    assert.match(
        bicep,
        /fullTextPaths: \[\n          \{\n            path: '\/description'\n            language: 'en-US'/u,
    );
    assert.match(bicep, /^        fullTextIndexes: \[\n          \{\n            path: '\/description'/mu);
});

test('provisions unique-key policies via Bicep without silently omitting them in Shell', () => {
    const { model, sampleData, project } = inputs();
    model.containers[0].uniqueKeyPolicy = { uniqueKeys: [{ paths: ['/docType', '/itemId'] }] };
    for (const type of ['azure', 'provision', 'emulator']) {
        project.phases.targetEnvironment.type = type;
        const artifacts = buildProvisioningArtifacts(model, sampleData, project);
        assert.match(artifacts['main.bicep'], /uniqueKeyPolicy: \{\n        uniqueKeys: \[/u);
        assert.match(artifacts['main.bicep'], /paths: \['\/docType', '\/itemId'\]/u);
        assert.match(artifacts['seed-data.csh'], /provision and verify containers via main.bicep or a supported SDK/u);
        assert.doesNotMatch(artifacts['seed-data.csh'], /^(?:create|index|throughput) /mu);
        assert.match(artifacts['seed-data.csh'], /mkitem --database=migration-db/u);
        assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
        artifacts['main.bicep'] = artifacts['main.bicep'].replace('uniqueKeyPolicy:', 'ignoredPolicy:');
        assert(validateProvisioningArtifacts(artifacts, model, sampleData, project).length > 0);
    }
});

test('generates full-text artifacts with seed-only Shell commands and detects policy drift', () => {
    const { model, sampleData, project } = inputs();
    model.containers[0].fullTextPolicy = {
        defaultLanguage: 'en-US',
        fullTextPaths: [{ path: '/description' }],
    };
    model.containers[0].indexingPolicy.fullTextIndexes = [{ path: '/description' }];
    for (const type of ['azure', 'provision']) {
        project.phases.targetEnvironment.type = type;
        const artifacts = buildProvisioningArtifacts(model, sampleData, project);
        assert.match(artifacts['main.bicep'], /fullTextPolicy: \{/u);
        assert.match(artifacts['main.bicep'], /fullTextIndexes: \[/u);
        assert.match(artifacts['seed-data.csh'], /provision and verify containers via main.bicep or a supported SDK/u);
        assert.doesNotMatch(artifacts['seed-data.csh'], /^(?:create|index|throughput) /mu);
        assert.match(artifacts['seed-data.csh'], /connect \$1/u);
        assert.match(
            artifacts['seed-data.csh'],
            /mkitem --database=migration-db --container=\$entry.containerName --upsert/u,
        );
        assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
        artifacts['main.bicep'] = artifacts['main.bicep'].replace('fullTextIndexes:', 'ignoredIndexes:');
        assert(validateProvisioningArtifacts(artifacts, model, sampleData, project).length > 0);
    }
    delete model.containers[0].indexingPolicy.fullTextIndexes;
    const policyOnly = buildProvisioningArtifacts(model, sampleData, project);
    assert.match(policyOnly['main.bicep'], /fullTextPolicy: \{/u);
    assert.doesNotMatch(policyOnly['seed-data.csh'], /^(?:create|index|throughput) /mu);
});

for (const capacityMode of ['provisioned', 'serverless']) {
    test(`adopts an existing ${capacityMode} account without managing account settings or roles`, () => {
        const { model, sampleData, project } = inputs();
        model.capacityMode = capacityMode;
        if (capacityMode === 'serverless') delete model.containers[0].maxThroughput;
        project.phases.targetEnvironment = {
            type: 'azure',
            endpoint: 'https://existing-account.documents.azure.com:443/',
            location: 'westus',
            verified: true,
        };
        const originalProject = structuredClone(project);
        const artifacts = buildProvisioningArtifacts(model, sampleData, project);
        assert.match(
            artifacts['main.bicep'],
            /resource account '[^']+' existing = \{\n  name: accountName\n\}/u,
        );
        assert.doesNotMatch(
            artifacts['main.bicep'],
            /disableLocalAuth|locations:|isZoneRedundant|capabilities:|consistencyPolicy|sqlRoleAssignments|param (?:location|principalId)/u,
        );
        assert.match(artifacts['main.bicep'], /resource database '[^']+' = \{/u);
        assert.match(artifacts['main.bicep'], /paths: \['\/tenantId', '\/itemId'\]/u);
        assert.match(artifacts['main.bicep'], /indexingPolicy:/u);
        if (capacityMode === 'provisioned') assert.match(artifacts['main.bicep'], /maxThroughput: 4000/u);
        else assert.doesNotMatch(artifacts['main.bicep'], /autoscaleSettings|EnableServerless/u);
        assert.match(artifacts['main.bicepparam'], /param accountName = 'existing-account'/u);
        assert.doesNotMatch(artifacts['main.bicepparam'], /param location/u);
        assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
        assert.deepEqual(project, originalProject);
    });
}

test('defaults to referencing an existing account without explicit new-account intent', () => {
    const { model, sampleData, project } = inputs();
    assert.match(buildBicep(model), /resource account '[^']+' existing =/u);
    for (const target of [undefined, { type: 'emulator', endpoint: 'https://localhost:8081' }]) {
        project.phases.targetEnvironment = target;
        const artifacts = buildProvisioningArtifacts(model, sampleData, project);
        assert.match(artifacts['main.bicep'], /resource account '[^']+' existing =/u);
        assert.doesNotMatch(artifacts['main.bicep'], /disableLocalAuth|sqlRoleAssignments/u);
    }
});

test('preserves new serverless account creation', () => {
    const { model, sampleData, project } = inputs();
    model.capacityMode = 'serverless';
    delete model.containers[0].maxThroughput;
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);
    assert.match(artifacts['main.bicep'], /resource account '[^']+' = \{/u);
    assert.match(artifacts['main.bicep'], /EnableServerless/u);
    assert.doesNotMatch(artifacts['main.bicep'], /autoscaleSettings/u);
    assert.doesNotMatch(artifacts['seed-data.csh'], /--scale|--ru|--max_throughput/u);
    assert.doesNotMatch(artifacts['seed-data.csh'], /^throughput /mu);
    assert.match(artifacts['seed-data.csh'], /--upsert/u);
});

test('adopts provisioned capacity for a serverless model without changing the model', () => {
    const { model, sampleData, project } = inputs();
    model.capacityMode = 'serverless';
    delete model.containers[0].maxThroughput;
    project.phases.targetEnvironment = {
        type: 'azure', endpoint: 'https://existing.documents.azure.com/',
        capacityMode: 'provisioned', maxThroughput: 2000,
    };
    const original = structuredClone({ model, project });
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);
    assert.match(artifacts['main.bicep'], /maxThroughput: 2000/u);
    assert.doesNotMatch(artifacts['main.bicep'], /EnableServerless|sqlRoleAssignments/u);
    assert.doesNotMatch(artifacts['seed-data.csh'], /^(?:create|index|throughput)\b/mu);
    assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
    assert.deepEqual({ model, project }, original);
});

test('retains capacity adaptation when adopting a previously created account', () => {
    const { model, sampleData, project } = inputs();
    model.capacityMode = 'serverless';
    delete model.containers[0].maxThroughput;
    project.phases.targetEnvironment = {
        type: 'provision', endpoint: 'https://existing.documents.azure.com/',
        resourceGroup: 'existing-group', subscriptionId: 'subscription-id',
        capacityMode: 'provisioned', maxThroughput: 3000,
    };
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);
    assert.match(artifacts['main.bicep'], /resource account '[^']+' existing =/u);
    assert.match(artifacts['main.bicep'], /maxThroughput: 3000/u);
    assert.match(artifacts['seed-data.csh'], /--subscription=subscription-id --resource-group=existing-group/u);
    assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
});

test('generates an approved new serverless alternative without changing the resource-group selection', () => {
    const { model, sampleData, project } = inputs();
    model.capacityMode = 'serverless';
    delete model.containers[0].maxThroughput;
    project.phases.targetEnvironment = {
        type: 'provision', accountName: 'new-serverless', capacityMode: 'serverless',
        subscriptionId: 'subscription-id', resourceGroup: 'existing-group', location: 'eastus',
    };
    const original = structuredClone(project);
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);
    assert.match(artifacts['main.bicep'], /EnableServerless/u);
    assert.doesNotMatch(artifacts['main.bicep'], /autoscaleSettings/u);
    assert.match(artifacts['main.bicepparam'], /param accountName = 'new-serverless'/u);
    assert.match(artifacts['seed-data.csh'], /--subscription=subscription-id --resource-group=existing-group/u);
    assert.deepEqual(project, original);
});

test('rejects the Azure downgrade but permits a serverless emulator without changing the model', () => {
    const { model, sampleData, project } = inputs();
    project.phases.targetEnvironment = { type: 'azure', endpoint: 'https://existing.documents.azure.com/', capacityMode: 'serverless' };
    assert.throws(() => buildProvisioningArtifacts(model, sampleData, project), /cannot satisfy a provisioned-capacity model/u);
    project.phases.targetEnvironment.type = 'emulator';
    const original = structuredClone(model);
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);
    assert.deepEqual(getProvisioningCapacity(model, model.containers[0], project.phases.targetEnvironment), { capacityMode: 'serverless' });
    assert.doesNotMatch(artifacts['seed-data.csh'], /--scale|--ru|^throughput /mu);
    assert.match(artifacts['main.bicep'], /maxThroughput: 4000/u);
    assert.deepEqual(model, original);
});

test('does not override modeled provisioned throughput with a lower target maximum', () => {
    const { model } = inputs();
    const target = { type: 'azure', capacityMode: 'provisioned', maxThroughput: 1000 };
    assert.deepEqual(getProvisioningCapacity(model, model.containers[0], target), {
        capacityMode: 'provisioned', maxThroughput: 4000,
    });
});

test('requires explicit valid throughput for a serverless model on provisioned Azure', () => {
    const { model } = inputs();
    model.capacityMode = 'serverless';
    delete model.containers[0].maxThroughput;
    for (const maxThroughput of [undefined, null, 0, 400, 1500, '2000']) {
        assert.throws(() => getProvisioningCapacity(model, model.containers[0], { type: 'azure', capacityMode: 'provisioned', maxThroughput }), /Select an autoscale maximum/u);
    }
});

test('uses provisioned emulator capacity without changing the serverless production model', () => {
    const { model, sampleData, project } = inputs();
    model.capacityMode = 'serverless';
    delete model.containers[0].maxThroughput;
    project.phases.targetEnvironment = { type: 'emulator', endpoint: 'https://localhost:8081/' };
    const originalModel = structuredClone(model);
    const originalProject = structuredClone(project);
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);

    assert.match(artifacts['seed-data.csh'], /--scale=auto --ru=1000/u);
    assert.match(artifacts['seed-data.csh'], /^throughput autoscale 1000 .* --yes$/mu);
    assert.doesNotMatch(artifacts['main.bicep'], /autoscaleSettings|maxThroughput/u);
    assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
    assert.deepEqual(model, originalModel);
    assert.deepEqual(project, originalProject);

    project.phases.targetEnvironment = { type: 'azure', endpoint: 'https://production.documents.azure.com/' };
    const production = buildProvisioningArtifacts(model, sampleData, project);
    assert.equal(production['main.bicep'], artifacts['main.bicep']);
    assert.doesNotMatch(production['seed-data.csh'], /--scale|--ru|^throughput /mu);
    assert(
        validateProvisioningArtifacts(artifacts, model, sampleData, project)
            .some(error => error.path === '$.seed-data.csh'),
    );
});

test('rejects Azure seed artifacts that replay resources or omit upsert', () => {
    const { model, sampleData, project } = inputs();
    for (const obsoleteSeed of [
        seed => `${seed}\ncreate container Items /tenantId,/itemId --database=migration-db`,
        seed => `${seed}\nindex set '{}' --database=migration-db --container=Items`,
        seed => `${seed}\nthroughput autoscale 4000 --database=migration-db --container=Items --yes`,
        seed => seed.replace(' --upsert', ''),
    ]) {
        const artifacts = buildProvisioningArtifacts(model, sampleData, project);
        artifacts['seed-data.csh'] = obsoleteSeed(artifacts['seed-data.csh']);
        const errors = validateProvisioningArtifacts(artifacts, model, sampleData, project);
        assert(errors.some(error => error.path === '$.seed-data.csh'));
    }
});

test('quotes indexing JSON using Cosmos Shell literal-string escaping', () => {
    const { model, sampleData, project } = inputs();
    project.phases.targetEnvironment = { type: 'emulator' };
    model.containers[0].indexingPolicy.excludedPaths.push({ path: '/"owner\'s label"/?' });
    const script = buildProvisioningArtifacts(model, sampleData, project)['seed-data.csh'];
    assert(script.includes("owner''s label"));
    assert.doesNotMatch(script, /'\\''/u);
});

test('regeneration converges on the same scoped names with updated configuration', () => {
    for (const type of ['azure', 'emulator']) {
        const { model, sampleData, project } = inputs();
        project.phases.targetEnvironment = { type };
        const first = buildProvisioningArtifacts(model, sampleData, project);
        model.containers[0].maxThroughput = 8000;
        model.containers[0].indexingPolicy.excludedPaths.push({ path: '/unused/*' });
        const second = buildProvisioningArtifacts(model, sampleData, project);
        assert.match(second['main.bicep'], /maxThroughput: 8000/u);
        assert.match(second['main.bicep'], /path: '\/unused\/\*'/u);
        if (type === 'emulator') {
            assert.match(second['seed-data.csh'], /--scale=auto --ru=8000/u);
            assert.match(second['seed-data.csh'], /^index set .*\/unused\/\*.* --database=migration-db --container=Items$/mu);
        } else {
            assert.equal(second['seed-data.csh'], first['seed-data.csh']);
            assert.doesNotMatch(second['seed-data.csh'], /^(?:create|index|throughput)\b/mu);
        }
        assert(validateProvisioningArtifacts(first, model, sampleData, project).length > 0);
        assert.deepEqual(validateProvisioningArtifacts(second, model, sampleData, project), []);
        assert.doesNotMatch(second['seed-data.csh'], /\b(?:rm|rmdb|rmcon|delete)\b/u);
    }
});

test('capability checks only run help and reject missing flags or failed executables', () => {
    const calls = [];
    const help = {
        connect: ['subscription', 'resource-group'],
        create: ['scale', 'ru', 'database', 'index_policy'],
        mkitem: ['force', 'upsert', 'database', 'container'],
        index: ['database', 'container'],
        throughput: ['database', 'container', 'yes'],
    };
    const run = (executable, args) => {
        assert.equal(executable, 'test-shell');
        assert.deepEqual(args.slice(0, 3), ['--output', 'json', '-c']);
        assert.match(args[3], /^help (connect|create|mkitem|index|throughput) --plain$/u);
        calls.push(args[3]);
        const command = args[3].split(' ')[1];
        return { status: 0, stdout: JSON.stringify({ command, options: help[command].map(name => ({ names: [name] })), parameters: [{ name: 'subcommand' }] }) };
    };
    assert.deepEqual(checkSeedShell('test-shell', run), []);
    assert.equal(calls.length, 5);
    help.connect = ['subscription'];
    assert(checkSeedShell('test-shell', run).some(error => error.path === 'connect.--resource-group'));
    help.connect = ['resource-group'];
    assert(checkSeedShell('test-shell', run).some(error => error.path === 'connect.--subscription'));
    help.connect = ['subscription', 'resource-group'];
    help.mkitem = help.mkitem.filter(name => name !== 'upsert');
    assert(checkSeedShell('test-shell', run).some(error => error.path === 'mkitem.--upsert'));
    assert(checkSeedShell('test-shell', () => ({ status: 0, stdout: 'legacy help text' })).length > 0);
    assert(checkSeedShell('test-shell', (executable, args) => {
        const result = run(executable, args);
        const metadata = JSON.parse(result.stdout);
        metadata.parameters = {};
        return { ...result, stdout: JSON.stringify(metadata) };
    }).some(error => error.path === 'index.set'));
    assert(checkSeedShell('test-shell', () => ({ status: 1, stdout: '{}' })).length > 0);
    assert(checkSeedShell('test-shell', () => ({ error: new Error('missing executable'), status: null })).length > 0);
});

const shellExecutable = process.env.MIGRATION_COSMOS_SHELL_EXECUTABLE;
if (shellExecutable) {
    test('real disconnected Shell accepts the generated script syntax and command options', () => {
        const run = command => {
            const result = spawnSync(shellExecutable, ['-c', command], {
                encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
            });
            assert.ifError(result.error);
            assert.equal(result.signal, null);
            return result;
        };
        assert.deepEqual(checkSeedShell(shellExecutable), []);
        for (const type of ['azure', 'emulator']) {
            for (const capacityMode of ['provisioned', 'serverless']) {
                const { model, sampleData, project } = inputs();
                model.capacityMode = capacityMode;
                if (capacityMode === 'serverless') delete model.containers[0].maxThroughput;
                project.phases.targetEnvironment = { type, subscriptionId: 'subscription-id', resourceGroup: 'migration(test)' };
                model.containers[0].indexingPolicy.excludedPaths.push({ path: '/"owner\'s label"/?' });
                const script = buildProvisioningArtifacts(model, sampleData, project)['seed-data.csh'];
                const syntax = run(`if false {\n${script}\n}`);
                assert.equal(syntax.status, 0, syntax.stdout + syntax.stderr);
                const commands = script.split('\n').filter(line => /^(?:create|index|throughput) /u.test(line));
                if (type === 'azure') assert.equal(commands.length, 0);
                else assert(commands.length > 0);
                commands.push(`$entry = ${JSON.stringify(sampleData.sampleData[0])}\n${script.split('\n').find(line => line.includes('mkitem '))}`);
                for (const command of commands) {
                    const result = run(command);
                    assert.notEqual(result.status, 0, 'Disconnected commands must fail before any resource access');
                    assert.match(result.stdout + result.stderr, /not connected/iu);
                }
            }
        }
        const connection = run('def connect [endpoint] { echo $endpoint }\n$1 = "offline endpoint"\nconnect $1');
        assert.equal(connection.status, 0, connection.stdout + connection.stderr);
        assert.match(connection.stdout, /offline endpoint/u);
    });
}

test('adopts previously provisioned accounts on resume without changing their checkpoint type', () => {
    const { model, sampleData, project } = inputs();
    const creationArtifacts = buildProvisioningArtifacts(model, sampleData, project);
    project.phases.targetEnvironment.endpoint = 'https://migration-account.documents.azure.com:443/';
    delete project.phases.targetEnvironment.location;
    for (const verified of [false, true]) {
        project.phases.targetEnvironment.verified = verified;
        const originalProject = structuredClone(project);
        const artifacts = buildProvisioningArtifacts(model, sampleData, project);
        assert.match(artifacts['main.bicep'], /resource account '[^']+' existing =/u);
        assert.doesNotMatch(artifacts['main.bicep'], /disableLocalAuth|locations:|capabilities:|sqlRoleAssignments/u);
        assert.doesNotMatch(artifacts['main.bicepparam'], /param location/u);
        assert.deepEqual(validateProvisioningArtifacts(artifacts, model, sampleData, project), []);
        assert(validateProvisioningArtifacts(creationArtifacts, model, sampleData, project).length > 0);
        assert.deepEqual(project, originalProject);
    }
});

test('rejects account-mutating artifacts after selecting an existing target', () => {
    const { model, sampleData, project } = inputs();
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);
    project.phases.targetEnvironment.type = 'azure';
    const errors = validateProvisioningArtifacts(artifacts, model, sampleData, project);
    assert(errors.some(error => error.path === '$.main.bicep'));
    assert(errors.some(error => error.path === '$.main.bicepparam'));
});

test('detects artifact drift', () => {
    const { model, sampleData, project } = inputs();
    const artifacts = buildProvisioningArtifacts(model, sampleData, project);
    artifacts['main.bicep'] += '// edited\n';
    assert(validateProvisioningArtifacts(artifacts, model, sampleData, project).some((error) => error.path === '$.main.bicep'));
});

test('requires concrete account settings for provision targets', () => {
    const { model, sampleData, project } = inputs();
    delete project.phases.targetEnvironment.location;
    assert.throws(() => buildProvisioningArtifacts(model, sampleData, project), /require location/u);
});

test('rejects oversized sample IDs and partition keys before generating artifacts', () => {
    for (const oversizedField of ['id', 'tenantId']) {
        const { model, sampleData, project } = inputs();
        const item = sampleData.sampleData[0].items[0];
        if (oversizedField === 'id') {
            model.containers[0].entities[0].attributes.find((attribute) => attribute.target === 'itemId').type =
                'string';
            item.itemId = 'a'.repeat(1019);
            item.id = `item-${item.itemId}`;
        } else item.tenantId = 'a'.repeat(2049);
        assert.throws(
            () => buildProvisioningArtifacts(model, sampleData, project),
            (error) => {
                assert.match(error.message, /Invalid sample data/);
                assert.match(
                    error.message,
                    oversizedField === 'id' ? /1023-byte limit/ : /2048-byte partition-key limit/,
                );
                assert(!error.message.includes(item[oversizedField]));
                return true;
            },
        );
    }
});

test('CLI refuses to overwrite a modified artifact without force', () => {
    const { model, sampleData, project } = inputs();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provisioning-artifacts-'));
    for (const [name, value] of Object.entries({ model, sampleData, project })) {
        fs.writeFileSync(path.join(root, `${name}.json`), JSON.stringify(value));
    }
    const args = [
        '--model',
        path.join(root, 'model.json'),
        '--sample-data',
        path.join(root, 'sampleData.json'),
        '--project',
        path.join(root, 'project.json'),
        '--output',
        root,
    ];
    try {
        assert.equal(runCli(args), 0);
        const firstArtifacts = Object.fromEntries(
            ['main.bicep', 'main.bicepparam', 'seed-data.csh'].map((name) => [
                name,
                fs.readFileSync(path.join(root, name), 'utf8'),
            ]),
        );
        assert.equal(runCli(args), 0);
        const secondArtifacts = Object.fromEntries(
            Object.keys(firstArtifacts).map((name) => [name, fs.readFileSync(path.join(root, name), 'utf8')]),
        );
        assert.deepEqual(secondArtifacts, firstArtifacts);
        assert.doesNotMatch(secondArtifacts['main.bicep'], /migration-db-\d+/u);
        assert.doesNotMatch(secondArtifacts['seed-data.csh'], /migration-db-\d+/u);
        fs.writeFileSync(path.join(root, 'main.bicep'), 'user edit\n');
        assert.equal(runCli(args), 1);
        assert.equal(fs.readFileSync(path.join(root, 'main.bicep'), 'utf8'), 'user edit\n');
    } finally {
        fs.rmSync(root, { recursive: true });
    }
});
