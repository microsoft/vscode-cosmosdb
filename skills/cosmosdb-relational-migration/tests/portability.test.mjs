import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from '../scripts/cli-arguments.mjs';
import { readProjectState } from '../scripts/project-state.mjs';
import { discoveryFixture, sourceFixture } from './source-evidence-fixtures.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceSkillRoot = path.resolve(testDirectory, '..');

test('value-taking options fail before helper work when their value is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-missing-options-'));
    try {
        const cases = [
            ['inspect-migration-state', ['--phase', 'preflight'], ['--workspace', '--phase', '--preflight-step', '--offset', '--limit', '--artifact']],
            ['check-sdk-compatibility', ['--language', 'Python'], ['--language', '--output']],
            ['validate-code-migration-plan', [], ['--workspace', '--project', '--sdk-report', '--manifest']],
            ['validate-schema-conversion-summary', [], ['--kind', '--model', '--workspace', '--domain']],
            ['validate-sample-data', [], ['--model', '--workspace']],
            ['validate-provisioning-verification', [], ['--model', '--sample-data', '--project']],
            ['check-phase-completion', [], ['--workspace', '--phase', '--offset', '--limit', '--artifact']],
            ['estimate-domain-tokens', [], ['--domain', '--domain-input', '--shared', '--rule', '--context-window', '--output-reserve', '--safety-margin', '--tool-output-bytes', '--characters-per-token', '--offset', '--limit']],
            ['freshness', [], ['--workspace', '--phase', '--expect', '--consulted']],
            ['generate-provisioning-artifacts', [], ['--model', '--sample-data', '--project', '--output', '--check-shell']],
            ['merge-cosmos-models', [], ['--manifest', '--capacity-evidence', '--database', '--capacity', '--output', '--input']],
            ['project-state', [], ['--workspace', '--get', '--offset', '--limit', '--set', '--value', '--expect', '--init']],
            ['setup-ddl-parser', ['--install'], ['--workspace', '--python', '--wheel-dir']],
            ['validate-cosmos-model', [], ['--reference-manifest', '--reference-registry', '--output']],
            ['validate-schema-conversion-domains', [], ['--workspace', '--reference-manifest', '--domain', '--offset', '--limit']],
        ];
        for (const [name, prefix, options] of cases) {
            for (const option of options) {
                for (const suffix of [[], [''], ['   '], ['--unknown-option'], ['-x'], ['--output', 'unexpected.json']]) {
                    const result = spawnSync(process.execPath, [
                        path.join(sourceSkillRoot, 'scripts', `${name}.mjs`), ...prefix, option, ...suffix,
                    ], { cwd: root, encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: '' } });
                    assert.equal(result.status, 1, `${name} ${option}: ${result.stdout}${result.stderr}`);
                    assert.equal(result.stdout, '', `${name} ${option}`);
                    const message = result.stderr.startsWith('{')
                        ? JSON.parse(result.stderr).errors[0].message
                        : result.stderr.trim();
                    assert.equal(message, `${option} requires a value. Run with --help for usage.`);
                    assert.deepEqual(fs.readdirSync(root), [], name);
                }
            }
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('option values preserve negative numbers, JSON literals, and paths with spaces', () => {
    for (const value of ['0', '-1', '-1e3', '-0.5', 'false', 'null', '""', '"--flag"', '{"key":"value"}', './--file with spaces.json']) {
        assert.equal(requireOptionValue(['--value', value], 0), value);
    }
});

test('domain assignments reject missing names and paths before reading inputs', () => {
    for (const [name, option] of [
        ['estimate-domain-tokens', '--domain'],
        ['estimate-domain-tokens', '--domain-input'],
        ['merge-cosmos-models', '--input'],
        ['validate-schema-conversion-domains', '--domain'],
    ]) {
        for (const value of ['Orders=', 'Orders=   ', '=model.json', ' =model.json']) {
            const result = spawnSync(process.execPath, [
                path.join(sourceSkillRoot, 'scripts', `${name}.mjs`), option, value,
            ], { encoding: 'utf8', timeout: 5000 });
            assert.equal(result.status, 1, `${name} ${value}`);
            assert.equal(result.stdout, '');
            assert.ok(result.stderr.includes(`${option} must use`), result.stderr);
            assert.doesNotMatch(result.stderr, /TypeError|ENOENT|EISDIR/u);
        }
    }
});

test('valid repeated options, output paths, optional TOC pointers, and negative JSON writes still work', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-valid-options-'));
    try {
        const run = (name, args) => {
            const result = spawnSync(process.execPath, [
                path.join(sourceSkillRoot, 'scripts', `${name}.mjs`), ...args,
            ], { cwd: root, encoding: 'utf8', timeout: 5000 });
            assert.equal(result.status, 0, `${name}: ${result.stderr}${result.stdout}`);
            return result;
        };
        const sdk = run('check-sdk-compatibility', ['--language', 'Python', '--language', 'TypeScript', '--output', './--sdk report.json']);
        assert.equal(sdk.stdout, '');
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, '--sdk report.json'), 'utf8')).version, 1);

        const initialized = JSON.parse(run('project-state', ['--init', 'Test Project', '--expect', 'missing']).stdout);
        const toc = JSON.parse(run('project-state', ['--toc', '--offset', '0', '--limit', '1']).stdout);
        assert.equal(toc.pointer, '');
        assert.equal(toc.entries.length, 1);
        run('project-state', ['--set', '/customValue', '--value', '-1e3', '--expect', initialized.revision]);
        const selected = JSON.parse(run('project-state', ['--get', '/customValue']).stdout);
        assert.equal(selected.value, -1000);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('every executable helper has complete, side-effect-free help without dependencies', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-helper-help-'));
    try {
        const scripts = path.join(sourceSkillRoot, 'scripts');
        const checkpoint = path.join(root, '.cosmosdb-migration', 'project.json');
        fs.mkdirSync(path.dirname(checkpoint));
        fs.writeFileSync(checkpoint, 'invalid JSON: help must not read this checkpoint');
        const before = fs.readdirSync(root, { recursive: true });
        for (const name of fs.readdirSync(scripts).filter(name => name.endsWith('.mjs'))) {
            const scriptPath = path.join(scripts, name);
            const source = fs.readFileSync(scriptPath, 'utf8');
            if (!source.includes('export function runCli(')) continue;
            const parserStart = source.indexOf('function parseArguments(');
            const cliSource = source.slice(parserStart >= 0 ? parserStart : source.indexOf('export function runCli('));
            const flags = new Set([...cliSource.matchAll(/'(--[a-z][a-z-]*)'/gu)].map(match => match[1]));
            for (const args of [
                ['--help'],
                ['-h'],
                ['--install', '--write', '--force', '--output', path.join(root, 'output'), '--unknown-option', '--help'],
            ]) {
                const result = spawnSync(process.execPath, [scriptPath, ...args], {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 5000,
                    env: { ...process.env, PATH: '' },
                });
                assert.equal(result.status, 0, `${name}: ${result.stderr}`);
                assert.equal(result.stderr, '', name);
                assert.ok(result.stdout.startsWith(`Usage: node ${name} `), name);
                assert.match(result.stdout, /Exit:/u, name);
                assert.match(result.stdout, /-h, --help/u, name);
                for (const flag of flags) assert.ok(result.stdout.includes(flag), `${name} help omits ${flag}`);
                assert.deepEqual(fs.readdirSync(root, { recursive: true }), before, name);
                assert.equal(fs.readFileSync(checkpoint, 'utf8'), 'invalid JSON: help must not read this checkpoint', name);
            }
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('isolated Skill helpers accept historical peer entries without any peer installation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-skill-portability-'));
    try {
        const copiedSkillRoot = path.join(root, 'installed', 'cosmosdb-relational-migration');
        fs.mkdirSync(path.dirname(copiedSkillRoot), { recursive: true });
        fs.cpSync(sourceSkillRoot, copiedSkillRoot, { recursive: true });
        const workspace = path.join(root, 'workspace');
        const project = { version: 1, name: 'app', sourceCode: 'parent', phases: { discovery: { preflightStatus: 'complete', status: 'complete' } } };
        const inventory = sourceFixture(workspace, project);
        discoveryFixture(workspace, inventory, project);
        project.freshness.preflight.inputs.push({
            id: 'peer-rule:SKILL.md', kind: 'skill-file', skill: 'cosmosdb-best-practices',
            path: 'SKILL.md', sha256: '0'.repeat(64),
        });
        fs.writeFileSync(path.join(workspace, '.cosmosdb-migration/project.json'), JSON.stringify(project));
        const run = (name, args, exitCode = 0) => {
            const result = spawnSync(process.execPath, [
                path.join(copiedSkillRoot, 'scripts', `${name}.mjs`), '--workspace', workspace, ...args,
            ], { encoding: 'utf8', cwd: root });
            assert.equal(result.status, exitCode, result.stderr || result.stdout);
            return result;
        };
        const revision = readProjectState(workspace).revision;
        assert.equal(JSON.parse(run('freshness', ['--phase', 'preflight']).stdout).freshness, 'current');
        assert.equal(JSON.parse(run('inspect-migration-state', ['--phase', 'discovery']).stdout).action, 'complete');
        assert.equal(JSON.parse(run('check-phase-completion', ['--phase', 'discovery']).stdout).complete, true);
        assert.equal(readProjectState(workspace).revision, revision);
        run('freshness', ['--phase', 'preflight', '--write', '--expect', revision]);
        assert.equal(readProjectState(workspace).project.freshness.preflight.inputs.some(input => input.kind === 'skill-file'), false);
        for (const name of ['freshness', 'inspect-migration-state', 'check-phase-completion']) {
            for (const option of ['--peer', '--peer-rule']) {
                const result = run(name, [option, 'unused'], 1);
                assert.equal(result.stderr.trim(), `Unexpected argument: ${option}`);
                assert.equal(result.stdout, '');
            }
            assert.doesNotMatch(run(name, ['--help']).stdout, /--peer/u);
        }
    } finally {
        fs.rmSync(root, { recursive: true });
    }
});

test('runs the validation suites from a standalone Skill copy without peer or DDL parser installations', { skip: process.env.MIGRATION_STANDALONE_CHILD === '1' }, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-complete-portability-'));
    try {
        const copied = path.join(root, 'skills', 'cosmosdb-relational-migration');
        fs.cpSync(sourceSkillRoot, copied, { recursive: true });
        const tests = fs.readdirSync(path.join(copied, 'tests')).filter(name => name.endsWith('.test.mjs') && name !== 'portability.test.mjs').map(name => path.join(copied, 'tests', name));
        const environment = { ...process.env, MIGRATION_STANDALONE_CHILD: '1' };
        delete environment.COSMOSDB_MIGRATION_PARSER_WORKSPACE;
        delete environment.MIGRATION_PARSER_WORKSPACE;
        delete environment.NODE_TEST_CONTEXT;
        const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...tests], {
            cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
            env: environment,
        });
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.match(result.stdout, /skipped 0/u);
    } finally { fs.rmSync(root, { recursive: true }); }
});
