/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkPhaseCompletion } from '../../skills/cosmosdb-migration/scripts/check-phase-completion.mjs';
import { buildFreshnessManifest } from '../../skills/cosmosdb-migration/scripts/freshness.mjs';
import { executeDocumentMapping } from '../../skills/cosmosdb-migration/scripts/mapping-examples.mjs';
import { mergeCosmosModels } from '../../skills/cosmosdb-migration/scripts/merge-cosmos-models.mjs';
import { modelHash } from '../../skills/cosmosdb-migration/scripts/validate-conversion-evidence.mjs';
import { canonicalStringify } from '../../skills/cosmosdb-migration/scripts/validate-cosmos-model.mjs';
import { stageAcceptedConversion } from './document-conversion/accepted.mjs';
import { checkConversion, replayConversion } from './document-conversion/check.mjs';
import { prepareDocument } from './document/fixtures.mjs';
import { temporaryWorkspace } from './workspace.mjs';

const skill = fileURLToPath(new URL('../../skills/cosmosdb-migration/', import.meta.url));
const conversion = 'phases/3-schema-conversion';
const domainPath = `${conversion}/domains/Activity/cosmos-model.json`;
const evidencePath = `${conversion}/manifest.json`;

async function withConversion(run) {
    const workspace = temporaryWorkspace();
    const path = (file) => join(workspace, '.cosmosdb-migration', file);
    const read = (file) => JSON.parse(readFileSync(path(file), 'utf8'));
    const write = (file, data) => writeFileSync(path(file), typeof data === 'string' ? data : JSON.stringify(data));
    try {
        await prepareDocument(workspace, 'document-conversion', skill);
        assert.ok(!existsSync(path(conversion)), 'The conversion trial must not see a reference conversion');
        await stageAcceptedConversion(workspace, skill);
        const inventory = read('phases/1-discovery/preflight-manifest.json').sourceInventory;
        const model = read(domainPath);
        const evidence = read(evidencePath);
        const save = () => {
            write(domainPath, model);
            evidence.domainSha256.Activity = modelHash(model);
            write(evidencePath, evidence);
            const { model: root } = mergeCosmosModels([{ domainName: 'Activity', model }], evidence);
            write(`${conversion}/model.json`, canonicalStringify(root));
            const project = read('project.json');
            project.freshness['schema-conversion'] = buildFreshnessManifest(workspace, project, 'schema-conversion');
            write('project.json', project);
        };
        await run({ workspace, path, read, write, inventory, model, evidence, save });
    } finally {
        rmSync(workspace, { recursive: true, force: true });
    }
}

test('accepts a reviewed conversion and equivalent container naming, natural-key alias and exact Int64 representation', async () => {
    await withConversion(async ({ workspace, model, evidence, save }) => {
        await checkConversion(workspace);
        const container = model.containers[0];
        container.name = 'AnotherValidLayout';
        const [entity] = container.entities;
        entity.attributes.find((entry) => entry.target === '_id').target = 'nativeKey';
        entity.attributes.find((entry) => entry.target === 'counter').type = 'object';
        for (const mapping of evidence.fieldMappings) {
            mapping.container = container.name;
            if (mapping.target === '_id') mapping.target = 'nativeKey';
            if (mapping.target === 'counter') {
                mapping.operation = 'copy';
                for (const example of mapping.examples) example.output = example.inputs[0];
            }
        }
        for (const record of [
            evidence.sourceDispositions[0].targets[0],
            evidence.documentMappings[0],
            evidence.identityExamples[0],
        ]) {
            record.container = container.name;
        }
        for (const item of [
            ...evidence.documentMappings[0].examples.map((entry) => entry.output),
            ...evidence.identityExamples[0].cases.map((entry) => entry.item),
        ]) {
            item.nativeKey = item._id;
            delete item._id;
            item.counter = { $numberLong: item.counter };
        }
        save();
        await checkConversion(workspace);
    });
});

test('a rename may preserve ordinary extras and block a source property that collides with its new target', async () => {
    await withConversion(async ({ workspace, model, evidence, save }) => {
        const target = 'handoffExtension';
        model.containers[0].entities[0].attributes.find((entry) => entry.target === 'detail').target = target;
        evidence.fieldMappings.find((entry) => entry.target === 'detail').target = target;
        for (const item of [
            ...evidence.documentMappings[0].examples.map((entry) => entry.output),
            ...evidence.identityExamples[0].cases.map((entry) => entry.item),
        ]) {
            if (Object.hasOwn(item, 'detail')) {
                item[target] = item.detail;
                delete item.detail;
            }
        }
        save();
        assert.equal(checkPhaseCompletion(workspace, 'schema-conversion').complete, true);
        await checkConversion(workspace);
    });
});

test('collision probes reject a mapper that silently clears a metadata conflict or stringifies an unknown native value', async () => {
    await withConversion(({ inventory, model, evidence }) => {
        for (const name of ['id', 'docType']) {
            const overwrite = (inventory, entity, mappings, decision, source, options) => {
                delete source[name];
                return executeDocumentMapping(inventory, entity, mappings, decision, source, options);
            };
            assert.throws(
                () => replayConversion(inventory, model, evidence, overwrite),
                new RegExp(`Unmapped root ${name} must block the write`, 'u'),
            );
        }
        const serialize = (inventory, entity, mappings, decision, source, options) =>
            executeDocumentMapping(inventory, entity, mappings, decision, JSON.parse(JSON.stringify(source)), options);
        assert.throws(
            () => replayConversion(inventory, model, evidence, serialize),
            /Do not silently serialize an unrepresented native value/u,
        );
    });
});

test('held-out replay rejects data loss and collisions independently of submitted examples', async () => {
    await withConversion(({ inventory, model, evidence }) => {
        const replay = (m, e) => replayConversion(inventory, m, e);
        replay(model, evidence);
        const droppingUnknown = structuredClone(evidence);
        droppingUnknown.documentMappings[0].mode = 'projection';
        assert.throws(() => replay(model, droppingUnknown), /Lost or modified additional source property/u);
        for (const [key, replacement] of [
            ['counter', String(Number(9223372036854775807n))],
            ['note', null],
            ['batches', [{ values: ['first'] }, { values: [] }, { values: ['two', 'one', 'two'], revision: 'later' }]],
            ['detail', { label: 'nested property' }],
        ]) {
            const changed = structuredClone(evidence);
            const mapping = changed.fieldMappings.find((entry) => entry.target === key);
            Object.assign(mapping, { inputs: [], operation: 'constant', constant: replacement });
            assert.throws(() => replay(model, changed), new RegExp(`Lost or changed source field: ${key}`, 'u'));
        }
        const colliding = structuredClone(model);
        colliding.containers[0].entities[0].identity.fields = [{ dataset: 'events', field: '$.tenantId' }];
        assert.throws(() => replay(colliding, evidence), /collide at the same item address/u);
    });
});

test('rejects predecessor byte changes, later-phase advancement, skipped domains, and a stale merged model', async () => {
    await withConversion(async ({ workspace, path, read, write }) => {
        await checkConversion(workspace);
        const previous = 'phases/2-assessment/assessment-summary.md';
        const original = readFileSync(path(previous), 'utf8');
        appendFileSync(path(previous), '\n');
        await assert.rejects(checkConversion(workspace), /Changed supplied or accepted file/u);
        write(previous, original);
        const project = read('project.json');
        const advanced = structuredClone(project);
        advanced.phases.provisioning.status = 'in-progress';
        write('project.json', advanced);
        await assert.rejects(checkConversion(workspace), /outside the request/u);
        write('project.json', {
            ...project,
            phases: { ...project.phases, schemaConversion: { status: 'complete', domains: [] } },
        });
        await assert.rejects(checkConversion(workspace), /Out-of-phase file|Do not skip/u);
        write('project.json', project);
        const root = read(`${conversion}/model.json`);
        root.containers[0].name = 'not-the-domain-model';
        write(`${conversion}/model.json`, canonicalStringify(root));
        await assert.rejects(checkConversion(workspace), /Root model differs/u);
    });
});
