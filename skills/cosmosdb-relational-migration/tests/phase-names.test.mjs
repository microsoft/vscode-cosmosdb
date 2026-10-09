import assert from 'node:assert/strict';
import test from 'node:test';
import { MIGRATION_PHASES, normalizePhaseName } from '../scripts/phase-names.mjs';

test('preserves every canonical phase name', () => {
    for (const phase of MIGRATION_PHASES) assert.equal(normalizePhaseName(phase), phase);
});

test('normalizes every deprecated numeric alias', () => {
    assert.deepEqual(
        ['0', '1', '2', '3', '4'].map(normalizePhaseName),
        ['preflight', 'discovery', 'assessment', 'schema-conversion', 'provisioning'],
    );
});

test('rejects unknown phase names', () => {
    assert.equal(normalizePhaseName('planning'), undefined);
    assert.equal(normalizePhaseName(undefined), undefined);
});
