import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readProjectState, selectProjectState, setProjectValue, updateProjectState } from '../scripts/project-state.mjs';

const script = fileURLToPath(new URL('../scripts/project-state.mjs', import.meta.url));

function fixture(context) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-project-state-'));
    context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
    updateProjectState(workspace, 'missing', () => ({ version: 1, name: 'app', sourceCode: 'parent',
        sessionId: 'keep', custom: { preserved: true }, phases: { discovery: { status: 'not-started', custom: 42 } },
        freshness: { preflight: { version: 1, inputs: Array.from({ length: 1000 }, (_, index) => ({ id: String(index), sha256: 'a'.repeat(64) })), outputs: [] } } }));
    return workspace;
}

test('returns compact summaries, scoped fields and bounded array pages', context => {
    const workspace = fixture(context);
    const state = readProjectState(workspace);
    const summary = selectProjectState(state);
    assert.equal(summary.freshness.preflight.inputCount, 1000);
    assert.equal(JSON.stringify(summary).includes('sha256'), false);
    assert.equal(selectProjectState(state, '/phases/discovery/custom').value, 42);
    assert.equal(selectProjectState(state, '/missing').found, false);
    const page = selectProjectState(state, '/freshness/preflight/inputs', 25, 2);
    assert.equal(page.total, 1000);
    assert.deepEqual(page.value.map(input => input.id), ['25', '26']);
    assert.throws(() => selectProjectState(state, '/freshness'), /narrower/u);
    assert.throws(() => selectProjectState(state, '/freshness/preflight/inputs', -1), /Offset/u);
    assert.throws(() => selectProjectState(state, '/freshness/preflight/inputs', 0, 101), /limit/u);
    assert.throws(() => selectProjectState(state, ''), /non-root/u);
});

test('summaries preserve target routing metadata without exposing unrelated fields', () => {
    for (const target of [
        { type: 'emulator', verified: false },
        { type: 'emulator', endpoint: 'https://localhost:8081/', verified: true },
        { type: 'azure', endpoint: 'https://account.documents.azure.com/', accountName: 'account', verified: false },
        { type: 'azure', endpoint: 'https://account.documents.azure.com/', capacityMode: 'provisioned', maxThroughput: 2000 },
        { type: 'emulator', capacityMode: 'serverless', verified: false },
        { type: 'provision', accountName: 'new-account', resourceGroup: 'group', subscriptionId: 'subscription',
            location: 'eastus' },
    ]) {
        const state = { revision: 'unchanged', project: { phases: {
            discovery: { status: 'complete', custom: 'hidden' },
            targetEnvironment: { ...target, custom: 'hidden', key: 'secret' },
        } } };
        const original = structuredClone(state);
        const summary = JSON.parse(JSON.stringify(selectProjectState(state)));
        assert.deepEqual(summary.phases.targetEnvironment, target);
        assert.deepEqual(summary.phases.discovery, { status: 'complete' });
        assert.equal(summary.revision, state.revision);
        assert.doesNotMatch(JSON.stringify(summary), /hidden|secret/u);
        assert.deepEqual(state, original);
    }
});

test('summaries do not invent a target selection', () => {
    const missing = selectProjectState({ project: { phases: {} } });
    assert.equal(Object.hasOwn(missing.phases, 'targetEnvironment'), false);
    const empty = JSON.parse(JSON.stringify(selectProjectState({ project: { phases: { targetEnvironment: {} } } })));
    assert.deepEqual(empty.phases.targetEnvironment, {});
});

test('TOC discovers root and subtree structure without returning stored values', context => {
    const workspace = fixture(context);
    const state = readProjectState(workspace);
    const root = selectProjectState(state, undefined, 0, 20, { toc: true });
    assert.equal(root.revision, state.revision);
    assert.equal(root.pointer, '');
    assert.equal(root.found, true);
    assert.equal(root.type, 'object');
    assert.equal(root.total, Object.keys(state.project).length);
    assert.deepEqual(root.entries.find(entry => entry.name === 'custom'), { name: 'custom', pointer: '/custom', type: 'object' });
    assert.equal(JSON.stringify(root).includes('"app"'), false);
    const manifest = selectProjectState(state, '/freshness/preflight', 0, 20, { toc: true });
    assert.deepEqual(manifest.entries.find(entry => entry.name === 'inputs'), {
        name: 'inputs', pointer: '/freshness/preflight/inputs', type: 'array', length: 1000,
    });
    assert.equal(JSON.stringify(manifest).includes('sha256'), false);
    const report = selectProjectState({ project: { text: 'sensitive'.repeat(10000), enabled: false, count: 42, empty: null } }, '', 0, 20, { toc: true });
    assert.deepEqual(report.entries.map(entry => entry.type), ['string', 'boolean', 'number', 'null']);
    assert.equal(JSON.stringify(report).includes('sensitive'), false);
    const scalar = selectProjectState({ project: { text: 'sensitive'.repeat(10000) } }, '/text', 0, 20, { toc: true });
    assert.equal(scalar.type, 'string');
    assert.equal(scalar.total, 0);
    assert.deepEqual(scalar.entries, []);
    assert.equal(Object.hasOwn(scalar, 'value'), false);
    assert.equal(readProjectState(workspace).revision, state.revision);
});

test('TOC paginates objects and arrays and provides the next offset', context => {
    const state = readProjectState(fixture(context));
    const root = selectProjectState(state, '', 1, 2, { toc: true });
    assert.deepEqual(root.entries.map(entry => entry.name), Object.keys(state.project).slice(1, 3));
    assert.equal(root.nextOffset, 3);
    const page = selectProjectState(state, '/freshness/preflight/inputs', 998, 1, { toc: true });
    assert.equal(page.total, 1000);
    assert.equal(page.length, 1000);
    assert.equal(page.nextOffset, 999);
    assert.deepEqual(page.entries, [{ name: '998', pointer: '/freshness/preflight/inputs/998', type: 'object' }]);
    assert.deepEqual(selectProjectState(state, page.entries[0].pointer).value, state.project.freshness.preflight.inputs[998]);
    const last = selectProjectState(state, '/freshness/preflight/inputs', 999, 10, { toc: true });
    assert.equal(last.entries.length, 1);
    assert.equal(last.nextOffset, undefined);
    assert.deepEqual(selectProjectState(state, '/freshness/preflight/inputs', 1001, 10, { toc: true }).entries, []);
    assert.equal(selectProjectState(state, '/freshness/preflight/inputs', undefined, undefined, { toc: true }).entries.length, 20);
    assert.throws(() => selectProjectState(state, '', -1, 20, { toc: true }), /Offset/u);
    assert.throws(() => selectProjectState(state, '', 0, 101, { toc: true }), /limit/u);
});

test('TOC pointers round-trip escaped and prototype-named own properties safely', () => {
    const project = JSON.parse('{"source/path":{"~name":1},"":null,"__proto__":{"own":true},"constructor":"custom"}');
    const state = { project };
    const root = selectProjectState(state, '', 0, 20, { toc: true });
    assert.deepEqual(root.entries.map(entry => entry.pointer), ['/source~1path', '/', '/__proto__', '/constructor']);
    for (const entry of root.entries) assert.deepEqual(selectProjectState(state, entry.pointer).value, project[entry.name]);
    const nested = selectProjectState(state, '/source~1path', 0, 20, { toc: true });
    assert.equal(nested.entries[0].pointer, '/source~1path/~0name');
    assert.equal(selectProjectState(state, nested.entries[0].pointer).value, 1);
    assert.equal(selectProjectState(state, '/toString', 0, 20, { toc: true }).found, false);
    assert.equal(selectProjectState(state, '/__proto__/toString', 0, 20, { toc: true }).found, false);
    assert.throws(() => setProjectValue(project, '/__proto__/own', false), /Unsafe/u);
    assert.throws(() => selectProjectState(state, '/source~2path', 0, 20, { toc: true }), /JSON pointer/u);
});

test('TOC distinguishes missing, null and empty values and enforces the response cap', () => {
    for (const [project, pointer, found, type] of [
        [undefined, '', false, undefined],
        [{}, '/missing', false, undefined],
        [{ empty: null }, '/empty', true, 'null'],
        [{}, '', true, 'object'],
        [{ items: [] }, '/items', true, 'array'],
    ]) {
        const report = selectProjectState({ project }, pointer, 0, 20, { toc: true });
        assert.equal(report.found, found);
        assert.equal(report.type, type);
        assert.equal(report.total, 0);
        assert.deepEqual(report.entries, []);
    }
    const state = { project: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`${index}-${'x'.repeat(500)}`, null])) };
    assert.throws(() => selectProjectState(state, '', 0, 20, { toc: true }), /exceeds 16 KiB/u);
    assert.equal(selectProjectState(state, '', 0, 1, { toc: true }).entries.length, 1);
});

test('merges scoped writes while preserving unrelated state and rejecting stale revisions', context => {
    const workspace = fixture(context);
    const original = readProjectState(workspace);
    const result = updateProjectState(workspace, original.revision, project => setProjectValue(project, '/phases/discovery', { status: 'in-progress' }));
    const saved = readProjectState(workspace);
    assert.equal(saved.revision, result.revision);
    assert.equal(saved.project.phases.discovery.custom, 42);
    assert.deepEqual(saved.project.freshness, original.project.freshness);
    assert.equal(saved.project.sessionId, 'keep');
    assert.deepEqual(saved.project.custom, { preserved: true });
    assert.throws(() => updateProjectState(workspace, original.revision, project => project), /Project changed/u);
    assert.throws(() => updateProjectState(workspace, saved.revision, project => setProjectValue(project, '/phases/discovery/status', 'invalid')), /Invalid project/u);
    assert.equal(readProjectState(workspace).revision, saved.revision);
    assert.deepEqual(fs.readdirSync(path.dirname(saved.projectPath)), ['project.json']);
});

test('detects a concurrent edit and removes its temporary checkpoint', context => {
    const workspace = fixture(context);
    const original = readProjectState(workspace);
    assert.throws(() => updateProjectState(workspace, original.revision, project => {
        fs.appendFileSync(original.projectPath, '\n');
        return project;
    }), /changed during update/u);
    assert.deepEqual(fs.readdirSync(path.dirname(original.projectPath)), ['project.json']);
    assert.notEqual(readProjectState(workspace).revision, original.revision);
});

test('handles escaped JSON pointers and rejects unsafe keys', () => {
    const project = { 'source/path': { '~name': 1 } };
    assert.equal(selectProjectState({ project }, '/source~1path/~0name').value, 1);
    assert.throws(() => setProjectValue(project, '/__proto__/polluted', true), /Unsafe/u);
    assert.throws(() => setProjectValue(project, '/settings', JSON.parse('{"constructor":{"polluted":true}}')), /Unsafe/u);
});

test('updates individual array records without replacing their unknown fields', () => {
    const project = { records: [{ name: 'Orders', custom: true }, { name: 'Customers' }] };
    setProjectValue(project, '/records/0', { name: 'Sales' });
    assert.deepEqual(project.records, [{ name: 'Sales', custom: true }, { name: 'Customers' }]);
    setProjectValue(project, '/records/1/name', 'Accounts');
    assert.equal(project.records[1].name, 'Accounts');
    assert.throws(() => setProjectValue(project, '/records/2', {}), /existing array index/u);
    assert.throws(() => setProjectValue(project, '/records/length', 0), /existing array index/u);
    assert.throws(() => setProjectValue(project, '/records/01/name', 'Invalid'), /existing array index/u);
});

test('CLI initializes and updates without printing the whole project', context => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-project-cli-'));
    context.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
    const invoke = (...args) => spawnSync(process.execPath, [script, '--workspace', workspace, ...args], { encoding: 'utf8' });
    const empty = JSON.parse(invoke().stdout);
    assert.equal(empty.revision, 'missing');
    const initialized = invoke('--init', 'app', '--expect', empty.revision);
    assert.equal(initialized.status, 0, initialized.stderr);
    const savedRevision = JSON.parse(initialized.stdout).revision;
    const updated = invoke('--set', '/phases/discovery', '--value', '{"status":"in-progress"}', '--expect', savedRevision);
    assert.equal(updated.status, 0, updated.stderr);
    assert.deepEqual(Object.keys(JSON.parse(updated.stdout)), ['revision']);
    assert.equal(invoke('--set', '/name', '--value', '"new"').status, 1);
    assert.equal(invoke('--set', '/name', '--value', '"new"', '--expect', savedRevision).status, 1);
    assert.equal(invoke('--get', '/name', '--value', '"new"').status, 1);
});

test('CLI supports root and subtree TOCs without allowing mixed reads or writes', context => {
    const workspace = fixture(context);
    const before = readProjectState(workspace);
    const invoke = (...args) => spawnSync(process.execPath, [script, '--workspace', workspace, ...args], { encoding: 'utf8' });
    const root = invoke('--toc');
    assert.equal(root.status, 0, root.stderr);
    assert.equal(JSON.parse(root.stdout).pointer, '');
    const page = invoke('--toc', '/freshness/preflight/inputs', '--offset', '10', '--limit', '2');
    assert.equal(page.status, 0, page.stderr);
    assert.deepEqual(JSON.parse(page.stdout).entries.map(entry => entry.name), ['10', '11']);
    const rootPage = invoke('--toc', '--limit', '1');
    assert.equal(rootPage.status, 0, rootPage.stderr);
    assert.equal(JSON.parse(rootPage.stdout).entries.length, 1);
    for (const args of [
        ['--toc', '--get', '/name'],
        ['--toc', '--toc'],
        ['--toc', 'invalid'],
        ['--toc', '--offset', '-1'],
        ['--toc', '--value', '"new"'],
        ['--toc', '--set', '/name', '--value', '"new"', '--expect', before.revision],
        ['--toc', '--init', 'app', '--expect', before.revision],
    ]) {
        const result = invoke(...args);
        assert.equal(result.status, 1, args.join(' '));
        assert.equal(result.stdout, '');
    }
    assert.equal(readProjectState(workspace).revision, before.revision);
});
