/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { checkPhaseCompletion } from '../../../skills/cosmosdb-migration/scripts/check-phase-completion.mjs';
import { executeDocumentMapping } from '../../../skills/cosmosdb-migration/scripts/mapping-examples.mjs';
import { readPartitionKeyValue } from '../../../skills/cosmosdb-migration/scripts/partition-key-values.mjs';
import { assertDocumentBoundary } from '../document/check.mjs';

// Host only. The first two records differ solely in the native type of _id; do not separate them by tenant or payload.
function heldOutDocuments(extraKey) {
    const hex = 'a0b1c2d3e4f567891234abcd';
    const first = {
        _id: { $oid: hex },
        tenantId: 'west',
        counter: { $numberLong: '9223372036854775807' },
        'detail.label': 'literal property',
        detail: { label: 'nested property', pendingReview: { by: ['beta', 'alpha'] } },
        batches: [{ values: ['two', 'one', 'two'], revision: 'later' }, { values: [] }, { values: ['first'] }],
        [extraKey]: {
            id: 'nested user key',
            docType: 'nested user type',
            readings: [false, null],
            literalObject: { $date: '1970-01-01T00:00:00.000Z' },
        },
    };
    return [
        first,
        { ...first, _id: hex },
        { ...first, _id: 'null-note', counter: { $numberLong: '-9223372036854775808' }, note: null },
        { ...first, _id: 'present-note', note: 'null' },
    ];
}

const missing = Symbol('absent');
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : missing);

// Check source meaning, not a particular reference target. The supported lossless representations here are raw JSON,
// decodable canonical JSON text, and exact decimal text for the validator's single native Int64 type.
function represents(actual, expected, key) {
    if (isDeepStrictEqual(actual, expected)) return true;
    if (typeof actual !== 'string' || expected === missing) return false;
    if (key === 'counter' && actual === expected.$numberLong) return true;
    try {
        return isDeepStrictEqual(JSON.parse(actual), expected);
    } catch {
        return false;
    }
}

// Independent oracle: inspect the *emitted* item using the submitted lineage only to locate its fields.
// Never compute expected values by running a second copy of the submitted operation or consulting its examples.
function assertPreservedDocument(source, item, dataset, mappings, mode) {
    const roots = dataset.fields.filter((field) => field.path.length === 1);
    for (const [key, value] of Object.entries(source)) {
        if (!roots.some((field) => field.path[0].name === key)) {
            assert.deepEqual(own(item, key), value, `Lost or modified additional source property: ${key}`);
        }
    }
    for (const field of roots) {
        const key = field.path[0].name;
        const expected = own(source, key);
        const candidates = [];
        for (const mapping of mappings) {
            const index = mapping.inputs.findIndex((ref) => ref.dataset === dataset.id && ref.field === field.id);
            if (index < 0 || (mode === 'preserve' && mapping.target !== key)) continue;
            const actual = own(item, mapping.target);
            candidates.push(mapping.operation === 'tuple' && Array.isArray(actual) ? own(actual, index) : actual);
        }
        if (!candidates.length) candidates.push(own(item, key));
        assert.ok(
            candidates.some((value) => represents(value, expected, key)),
            `Lost or changed source field: ${key}`,
        );
    }
}

export function replayConversion(inventory, model, evidence, mapDocument = executeDocumentMapping) {
    const dataset = inventory.datasets.find((entry) => entry.id === 'events');
    const rootNames = new Set(
        dataset.fields.filter((field) => field.path.length === 1).map((field) => field.path[0].name),
    );
    const dispositions = evidence.sourceDispositions?.find((entry) => entry.sourceDataset === dataset.id)?.targets;
    const routes = new Set();
    let authoritative = 0;
    for (const decision of evidence.documentMappings) {
        const matches = (entry) =>
            entry.domain === decision.domain &&
            entry.container === decision.container &&
            entry.entity === decision.entity;
        const container = model.containers.find((entry) => entry.name === decision.container);
        const entity = container?.entities.find((entry) => entry.name === decision.entity);
        assert.equal(decision.domain, model.domain);
        assert.equal(entity?.sourceDataset, dataset.id, 'Unowned document target');
        const mappings = evidence.fieldMappings.filter(matches);
        const primary = !dispositions || dispositions.some((entry) => matches(entry) && entry.kind !== 'projection');
        if (primary) authoritative++;
        const execute = (source) =>
            mapDocument(inventory, entity, mappings, decision, structuredClone(source), {
                partitionKeys: container.partitionKeys,
                defaultTtl: container.defaultTtl,
            });
        const targets = new Set(mappings.map(({ target }) => target));
        // A legitimate rename can use our preferred probe name. Test ordinary extras and collisions separately.
        let extraKey = 'handoffExtension';
        while (rootNames.has(extraKey) || targets.has(extraKey)) extraKey += '_';
        const sources = heldOutDocuments(extraKey);
        for (const source of sources) {
            const item = execute(source);
            if (primary) assertPreservedDocument(source, item, dataset, mappings, decision.mode);
            if (!entity.isEmbeddedOnly) {
                assert.equal(typeof item.id, 'string', 'Expected a source-derived item id');
                const route = container.partitionKeys.map(({ path }) => readPartitionKeyValue(item, path));
                const address = JSON.stringify([container.name, route, item.id]);
                assert.ok(
                    !routes.has(address),
                    'Different native identities or target entities collide at the same item address',
                );
                routes.add(address);
            }
        }
        if (primary) {
            // The frozen inventory has no lineage for these additional roots. A bounded mapping cannot escape
            // them dynamically. Require the specific refusal, not an unrelated error or a partially mapped item.
            const collisions = new Set(['id', 'docType', '_etag', ...targets]);
            if (container.defaultTtl !== undefined && !entity.isEmbeddedOnly) collisions.add('ttl');
            for (const name of collisions) {
                if (rootNames.has(name)) continue;
                assert.throws(
                    () => execute({ ...sources[0], [name]: 'source-owned value' }),
                    /collides with target metadata|overwrite an unaccounted source property/u,
                    `Unmapped root ${name} must block the write`,
                );
            }
            // An actual native Date is not a JSON value. This tests the helper's input boundary, not a production
            // BSON decoder: a literal JSON object shaped like Extended JSON is not proof of a native type.
            assert.throws(
                () => execute({ ...sources[0], [extraKey]: { recordedAt: new Date(0) } }),
                /requires plain JSON objects/u,
                'Do not silently serialize an unrepresented native value',
            );
        }
    }
    assert.equal(authoritative, 1, 'The schema-only events collection must have one authoritative target');
    assert.ok(routes.size, 'No routable documents produced');
}

export async function checkConversion(workspace) {
    await assertDocumentBoundary(workspace, 'document-conversion');
    const read = (path) => JSON.parse(readFileSync(join(workspace, '.cosmosdb-migration', path), 'utf8'));
    const project = read('project.json');
    assert.deepEqual(
        project.phases.schemaConversion.domains,
        ['Activity'],
        'Do not skip the unmapped schema-only domain',
    );
    assert.equal(project.phases.schemaConversion.status, 'complete');
    // Includes domain ownership, reshape evidence, submitted examples, canonical merge, and freshness checks
    // against the trusted skill on the host (not any implementation in the trial workspace).
    const result = checkPhaseCompletion(workspace, 'schema-conversion');
    assert.equal(result.complete, true, JSON.stringify(result, null, 2));
    const conversion = 'phases/3-schema-conversion';
    replayConversion(
        read('phases/1-discovery/preflight-manifest.json').sourceInventory,
        read(`${conversion}/domains/Activity/cosmos-model.json`),
        read(`${conversion}/manifest.json`),
    );
}
