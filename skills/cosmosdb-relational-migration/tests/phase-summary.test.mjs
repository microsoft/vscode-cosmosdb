import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertNoTerminalIssues, readDomainModel, readPhaseEvidence, validateSummary } from '../scripts/phase-summary.mjs';

test('reads machine contracts from JSON independently of user-editable summaries', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-summary-'));
    const evidencePath = path.join(directory, 'manifest.json');
    const domainPath = path.join(directory, 'domain-manifest.json');
    const evidence = { version: 1, blockingIssues: [], sourceSha256: 'abc' };
    const domain = { version: 1, domain: 'Sales', containers: [] };
    fs.writeFileSync(evidencePath, JSON.stringify(evidence));
    fs.writeFileSync(domainPath, JSON.stringify(domain));

    validateSummary('# Summary\n\n## Overview\nUser clarification.\n', ['Overview']);
    assert.deepEqual(readPhaseEvidence(evidencePath), evidence);
    assert.deepEqual(readDomainModel(domainPath), domain);
});

test('preserves design decisions without vetoing evidence acceptance', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-decisions-'));
    try {
        const manifestPath = path.join(directory, 'manifest.json');
        const evidence = {
            version: 1,
            blockingIssues: [{ kind: 'design-decision', message: 'Choose an index tuning strategy.' }],
            sourceSha256: 'abc',
        };
        fs.writeFileSync(manifestPath, JSON.stringify(evidence));
        assert.deepEqual(readPhaseEvidence(manifestPath), evidence);
    } finally {
        fs.rmSync(directory, { recursive: true });
    }
});

test('rejects evidenced correctness failures but not design decisions', () => {
    for (const kind of ['invalid-model', 'data-loss', 'unsupported-behavior', 'failed-validation']) {
        const issues = [
            { kind: 'design-decision', message: 'Index tuning remains advisory.' },
            { kind, message: 'A required guarantee is violated.', evidence: ['summary.md#validation'] },
        ];
        assert.throws(() => assertNoTerminalIssues(issues), /reports a terminal/u);
    }
    assert.doesNotThrow(() => assertNoTerminalIssues([]));
});

test('requires explicit issue classification and evidence rather than guessing from prose', () => {
    for (const issues of [
        undefined, null, {}, [null], [[]], [1], ['Choose a partition key.'], ['Data will be lost.'],
        [{}], [{ kind: 'design-decision', message: '' }], [{ kind: 'unknown', message: 'Pending.' }],
        [{ kind: 'data-loss', message: 'A column is omitted.' }],
        [{ kind: 'data-loss', message: 'A column is omitted.', evidence: [] }],
        [{ kind: 'data-loss', message: 'A column is omitted.', evidence: [' '] }],
    ]) assert.throws(() => assertNoTerminalIssues(issues), /blockingIssues/u);
});

test('rejects unclassified evidence and structurally incomplete summaries', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-summary-'));
    const manifestPath = path.join(directory, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, blockingIssues: ['Resolve mapping.'] }));

    assert.throws(() => readPhaseEvidence(manifestPath), /reclassify/u);
    assert.throws(() => validateSummary('# Summary\n', ['Overview']), /Missing or empty report section: Overview/u);
});
