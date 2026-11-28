/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const declaration = 'List events for one tenant by tenantId.';
export const validator = 'evidence/validator.json';
export const collection = 'evidence/collection.json';
export const sample = 'evidence/sample.json';
export const workload = 'evidence/workload.md';
const sources = [validator, collection, sample, workload];
const migration = '.cosmosdb-migration';
const discovery = `${migration}/phases/1-discovery`;
const assessment = `${migration}/phases/2-assessment`;

function write(workspace, path, content) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    writeFileSync(
        join(workspace, path),
        typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
}

function stageInputs(workspace) {
    write(workspace, validator, {
        ns: 'journal.events',
        validator: {
            $jsonSchema: {
                bsonType: 'object',
                required: ['_id', 'tenantId', 'counter'],
                properties: {
                    _id: { bsonType: ['objectId', 'string'] },
                    tenantId: { bsonType: 'string' },
                    counter: { bsonType: 'long' },
                    note: { bsonType: ['null', 'string'] },
                },
                additionalProperties: true,
            },
        },
        validationLevel: 'strict',
        validationAction: 'error',
    });
    write(workspace, collection, {
        ns: 'journal.events',
        type: 'collection',
        sharded: false,
        identityScope: 'The unique _id index enforces uniqueness across the whole events collection.',
        indexes: [
            { name: '_id_', key: { _id: 1 }, unique: true },
            { name: 'tenantId_1', key: { tenantId: 1 }, unique: false },
        ],
    });
    write(workspace, sample, [
        {
            _id: { $oid: '62a103000000000000000001' },
            tenantId: 'north',
            counter: { $numberLong: '9007199254740993' },
            detail: { label: 'nested' },
            'detail.label': 'literal key',
            batches: [{ values: ['late', 'early'] }, { values: ['late'] }],
            note: null,
        },
        {
            _id: '62a103000000000000000002',
            tenantId: 'north',
            counter: { $numberLong: '24' },
            batches: [],
        },
    ]);
    write(
        workspace,
        workload,
        `# Journal export handoff

This is a synthetic schema-only MongoDB migration for journal.events. There is no application code.
validator.json and collection.json are the engineer's authoritative collection and index exports.
sample.json is a convenience sample of two documents in canonical Extended JSON, not a census.

The engineer confirms exactly one read requirement: ${declaration}
There are no production logs, measured rates, size estimates, growth figures or latency targets.
Record missing quantities as unknown. No other access path is confirmed.
`,
    );
}

function reviewedInventory(fileSha256, sourceFieldId, workspace) {
    const files = sources.map((path, i) => ({
        path,
        sha256: fileSha256(join(workspace, path)),
        kind: ['metadata', 'metadata', 'sample', 'documentation'][i],
        disposition: 'used',
        rationale: [
            'Native validator defines required fields and allowed BSON types.',
            'Collection metadata establishes index keys, uniqueness and scope.',
            'Bounded sample shows nested, dotted and array shapes beyond the validator.',
            'Engineer supplied scope, sampling context and the read requirement.',
        ][i],
        provenance: {
            method: ['engineer export', 'engineer export', 'convenience sample', 'engineer declaration'][i],
            scope:
                path === sample
                    ? 'Two synthetic journal.events records only; other variants may exist.'
                    : 'journal.events',
        },
    }));
    const field = (segments, nativeTypes, presence = 'unknown', nullable = null, evidence = [sample]) => {
        const path = segments.map((name) => (name === null ? { kind: 'array' } : { kind: 'property', name }));
        return { id: sourceFieldId(path), path, nativeTypes, presence, nullable, evidence };
    };
    return {
        version: 2,
        source: { engine: 'MongoDB', version: null, namespaces: ['journal'], capabilities: [] },
        files,
        datasets: [
            {
                id: 'events',
                name: 'journal.events',
                kind: 'document',
                evidence: [validator, collection, sample],
                coverage: {
                    basis: 'observed',
                    scope: 'Open validator plus shapes present in the selected sample.',
                    complete: false,
                    sampling: {
                        method: 'convenience export',
                        size: 2,
                        limitations: 'Two documents cannot exhaust the allowed shapes.',
                    },
                },
                fields: [
                    field(['_id'], ['ObjectId', 'string'], 'required', false, [validator, collection, sample]),
                    field(['tenantId'], ['string'], 'required', false, [validator, sample]),
                    field(['counter'], ['long'], 'required', false, [validator, sample]),
                    field(['note'], ['string', 'null'], 'optional', true, [validator, sample]),
                    field(['detail'], ['object'], 'optional'),
                    field(['detail', 'label'], ['string']),
                    field(['detail.label'], ['string'], 'optional'),
                    field(['batches'], ['array']),
                    field(['batches', null], ['object']),
                    field(['batches', null, 'values'], ['array']),
                    field(['batches', null, 'values', null], ['string']),
                ],
                identities: [
                    { id: 'native-id', kind: 'native', fields: ['$._id'], scope: 'collection', evidence: [collection] },
                ],
                indexes: [
                    {
                        name: 'tenantId_1',
                        fields: ['$.tenantId'],
                        direction: 'ascending',
                        unique: false,
                        evidence: [collection],
                    },
                ],
            },
        ],
        relationships: [],
        semantics: [],
        errors: [],
    };
}

export async function prepareDocument(workspace, scenario, skillRoot) {
    const scenarios = [
        'document-preflight',
        'document-discovery',
        'document-assessment',
        'document-conversion',
        'document-planning',
    ];
    assert.ok(scenarios.includes(scenario), `Unknown document fixture: ${scenario}`);
    if (scenario === 'document-planning') {
        await prepareDocument(workspace, 'document-conversion', skillRoot);
        // Only the planning workspace receives the reviewed conversion setup entry.
        const { stageAcceptedConversion } = await import('../document-conversion/accepted.mjs');
        await stageAcceptedConversion(workspace, skillRoot);
        return;
    }
    stageInputs(workspace);
    const project = {
        version: 1,
        name: 'Journal',
        sourceCode: 'parent',
        consentGiven: true,
        sessionId: '9102c9e4-3188-45da-a411-e85cf92bd73a',
        runCounts: {},
        customMetadata: { evidenceOwner: 'journal-team' },
        phases: {
            discovery: {
                preflightStatus: 'not-started',
                status: 'not-started',
                schemaInventory: { files: sources.map((name) => `../${name}`), excludedFiles: [] },
                accessPatterns: { files: [`../${workload}`], excludedFiles: [] },
            },
            assessment: { status: 'not-started', domains: [] },
            schemaConversion: { status: 'not-started', domains: [] },
            provisioning: { status: 'not-started' },
            codeMigration: { status: 'not-started' },
        },
    };
    const save = () => write(workspace, `${migration}/project.json`, project);
    save();
    if (scenario === 'document-preflight') return;

    const script = (name) => import(pathToFileURL(join(skillRoot, 'scripts', name)).href);
    const { buildFreshnessManifest, fileSha256 } = await script('freshness.mjs');
    const { sourceFieldId } = await script('source-contract.mjs');
    const { sourceFilesHash } = await script('validate-source-evidence.mjs');
    const inventory = reviewedInventory(fileSha256, sourceFieldId, workspace);
    const sourceSha256 = sourceFilesHash(inventory.source.engine, inventory.files);
    const manifest = (path, data) => write(workspace, path, { version: 1, blockingIssues: [], sourceSha256, ...data });
    const checkpoint = (phase) => {
        project.freshness ??= {};
        project.freshness[phase] = buildFreshnessManifest(workspace, project, phase);
        save();
    };
    Object.assign(project.phases.discovery, {
        preflightStatus: 'complete',
        applicationAnalysis: {
            codebaseAvailable: false,
            projectName: 'Journal',
            databaseType: 'MongoDB',
            completedAt: '2026-10-01T00:00:00Z',
        },
    });
    write(
        workspace,
        `${discovery}/preflight-summary.md`,
        `# Journal preflight
## Summary
Reviewed the supplied journal.events validator, native index metadata, bounded export and workload handoff.
## Warnings
Two sampled documents do not establish complete field coverage, access rates or global uniqueness.
## Decisions
Work is schema-only. The unsharded collection enforces unique _id. Its ascending tenantId index is not unique.
`,
    );
    manifest(`${discovery}/preflight-manifest.json`, {
        sourceInventory: inventory,
        workloadInputs: [
            {
                source: 'access-patterns',
                path: workload,
                sha256: fileSha256(join(workspace, workload)),
                disposition: 'used',
                evidenceKind: 'synthetic',
                rationale: 'Engineer-declared synthetic read, without measured traffic.',
            },
        ],
    });
    write(
        workspace,
        `${discovery}/volumetrics/volumetrics.md`,
        `# Volumetrics
| # | Namespace | Dataset | Est. Record Count | Avg Record Size (KB) | Growth Rate (month) | Read TPS | Write TPS | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | journal | events | unknown | unknown | unknown | unknown | unknown | No population or traffic estimates supplied. |
`,
    );
    write(
        workspace,
        `${discovery}/access-patterns/access-patterns.md`,
        `# Access Patterns
## Read Patterns
| # | Pattern Name | Datasets | Filter / Lookup Fields | Frequency (TPS) | Latency Requirement | Notes |
|---|---|---|---|---|---|---|
| R001 | List tenant events | events | tenantId | unknown | unknown | Engineer declaration: ${declaration} |
## Write Patterns
| # | Pattern Name | Datasets | Single / Batch | Frequency (TPS) | Latency Requirement | Notes |
|---|---|---|---|---|---|---|
`,
    );
    checkpoint('preflight');
    if (scenario === 'document-discovery') return;

    project.phases.discovery.status = 'complete';
    write(
        workspace,
        `${discovery}/discovery-report.md`,
        `# Journal discovery
## Source Overview
MongoDB journal.events is reviewed without application files or SDK evidence.
## Read Patterns
R001 is engineer-declared: ${declaration} R002 is a possible single-event lookup by _id, inferred only from its index.
## Write Patterns
No write requirement or observed traffic was supplied.
## Source Semantics
The native _id index is unique within the collection, whereas the tenantId index is not unique.
## Warnings
The sample is bounded. Confirm R002 with the application owner and obtain workload measurements.
`,
    );
    manifest(`${discovery}/discovery-manifest.json`, {
        datasets: ['events'],
        patterns: [
            {
                id: 'R001',
                kind: 'read',
                datasets: ['events'],
                evidence: 'user-declared',
                declaration,
                operation: declaration,
                tps: null,
                sourcePaths: [workload],
            },
            {
                id: 'R002',
                kind: 'read',
                datasets: ['events'],
                evidence: 'schema-inferred',
                operation: 'Look up one event by _id.',
                tps: null,
                sourcePaths: [collection],
            },
        ],
        noObservedAccess: [],
    });
    checkpoint('discovery');
    if (scenario === 'document-assessment') return;

    project.phases.assessment = {
        status: 'complete',
        domains: [
            {
                name: 'Activity',
                datasets: ['events'],
                isMapped: false,
                estimatedTokens: 1600,
                crossDomainDependencies: [],
            },
        ],
    };
    write(
        workspace,
        `${assessment}/assessment-summary.md`,
        `# Journal assessment
## Overview
The selected collection records journal activity. No source code was provided.
## Domains
The activity domain owns events once, independent of whether application code is mapped.
## Cross-Domain Dependencies
None; there is one in-scope collection.
## Recommendations
Retain the native evidence and review the declared tenant read during schema conversion.
## Warnings
The _id read is not a confirmed workload, and neither traffic nor an application mapping was observed.
`,
    );
    manifest(`${assessment}/assessment-manifest.json`, {
        datasets: ['events'],
        domains: ['Activity'],
        crossDomainEdges: [],
    });
    write(
        workspace,
        `${assessment}/domains/Activity.md`,
        `# Activity
## Purpose
Own journal activity records and their engineer-declared tenant read.
## Datasets
events (journal.events) is the sole dataset.
## Access Patterns
R001 reads events by tenantId. R002, an _id lookup, is a candidate, not an application operation.
## Cross-Domain Dependencies
None identified.
`,
    );
    manifest(`${assessment}/domains/Activity.manifest.json`, { domain: 'Activity', datasets: ['events'] });
    checkpoint('assessment');
}
