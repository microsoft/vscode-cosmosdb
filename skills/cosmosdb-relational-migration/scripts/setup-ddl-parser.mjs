#!/usr/bin/env node
// Purpose: Check or install the pinned SQLGlot environment used to parse source DDL.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireOptionValue } from './cli-arguments.mjs';
import { showHelp } from './cli-help.mjs';
import { resolveDdlParsingFallback } from './validate-migration-project.mjs';

export const SQLGLOT_VERSION = '30.18.0';
const scriptRoot = path.dirname(fileURLToPath(import.meta.url));

export function parserPython(workspace) {
    return path.join(workspace, '.cosmosdb-migration', '.tools', `sqlglot-${SQLGLOT_VERSION}`,
        ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
}

function assertLocalTools(workspace) {
    const root = fs.realpathSync(workspace);
    let current = path.dirname(path.dirname(parserPython(workspace)));
    while (!fs.existsSync(current)) current = path.dirname(current);
    const relative = path.relative(root, fs.realpathSync(current));
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Parser environment must remain inside the workspace.');
    }
}

export function checkParser(workspace) {
    assertLocalTools(workspace);
    const python = parserPython(workspace);
    if (!fs.existsSync(python)) return { ready: false, python, version: SQLGLOT_VERSION, reason: 'Parser environment is missing.' };
    const result = spawnSync(python, ['-I', '-c',
        'import importlib.metadata, json, sys; print(json.dumps({"version": importlib.metadata.version("sqlglot"), "python": list(sys.version_info[:2])}))'],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
    let metadata;
    try { metadata = JSON.parse(result.stdout); } catch { metadata = undefined; }
    const ready = result.status === 0 && metadata?.version === SQLGLOT_VERSION && metadata?.python?.[0] === 3 && metadata.python[1] >= 11;
    return { ready, python, version: SQLGLOT_VERSION, ...(ready ? {} : { reason: 'Expected Python 3.11+ and the pinned SQLGlot version.' }) };
}

function unavailableParserResult(choice, reason) {
    if (!choice || choice.method !== 'sqlglot') return { ready: false, reason };
    const resolution = resolveDdlParsingFallback(choice, { reason: 'unavailable' });
    if (resolution.abort) return { ready: false, abort: true, ...resolution.choice, reason: `${resolution.error} ${reason}` };
    return { ready: false, abort: false, ...resolution.choice, warning: resolution.warning, reason };
}

export function setupParser({ workspace, install = false, python, wheelDirectory }, execute = spawnSync) {
    workspace = path.resolve(workspace);
    const projectPath = path.join(workspace, '.cosmosdb-migration/project.json');
    let choice;
    if (fs.existsSync(projectPath)) {
        choice = JSON.parse(fs.readFileSync(projectPath, 'utf8')).phases?.discovery?.ddlParsing;
        if (choice?.method === 'model') return { ready: false, method: 'model', reason: 'External dependency use is disabled by the saved DDL parsing choice.' };
    }
    const before = checkParser(workspace);
    if (before.ready) return before;
    if (!install) return unavailableParserResult(choice, before.reason);
    const destination = path.dirname(path.dirname(before.python));
    if (fs.existsSync(destination)) {
        const reason = `Existing parser environment is invalid; inspect it before replacing: ${destination}`;
        if (choice) return unavailableParserResult(choice, reason);
        throw new Error(reason);
    }
    const basePython = python ?? (process.platform === 'win32' ? 'py' : 'python3');
    const prefix = !python && process.platform === 'win32' ? ['-3'] : [];
    const run = (command, args) => {
        const result = execute(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
        if (result.status !== 0) throw new Error(`Parser setup failed (${result.status ?? result.error?.code}): ${result.stderr ?? ''}`);
    };
    try {
        run(basePython, [...prefix, '-I', '-c', 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ is required"']);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const ignorePath = path.join(path.dirname(destination), '.gitignore');
        if (!fs.existsSync(ignorePath)) fs.writeFileSync(ignorePath, '*\n');
        run(basePython, [...prefix, '-I', '-m', 'venv', '--copies', destination]);
        run(before.python, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--no-input',
            '--only-binary=:all:', '--no-deps', '--require-hashes', '-r', path.join(scriptRoot, 'requirements-ddl.txt'),
            ...(wheelDirectory ? ['--no-index', '--find-links', path.resolve(wheelDirectory)] : ['--index-url', 'https://pypi.org/simple'])]);
        const after = checkParser(workspace);
        return after.ready ? after : unavailableParserResult(choice, after.reason);
    } catch (error) {
        const result = unavailableParserResult(choice, error.message);
        if (!choice) throw error;
        return result;
    }
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node setup-ddl-parser.mjs [--workspace <path>] [--install] [options]

Check the optional pinned SQLGlot environment. This helper does not parse DDL.
Respects the saved DDL parsing choice; model-only mode never installs or invokes SQLGlot.

    --workspace <path>  Application root; default current working directory.
    --install           Create a workspace-local venv and install the pinned, hashed dependency.
                                            May access PyPI; follow saved choice and host consent before using.
    --python <exe>      Python 3.11+ executable for installation; default python3 (py -3 on Windows).
    --wheel-dir <path>  Install from a local wheel directory instead of PyPI; requires --install to act.

Without --install, only checks readiness (may execute the existing local Python).
An invalid existing environment is not replaced automatically. Outputs JSON with next action.
Exit: 0 when ready or model-only fallback is allowed; 1 when unavailable, strict selection
requires abort, or setup fails. Read ready, method, abort, and next in the JSON.
`)) return 0;
    try {
        const options = { workspace: process.cwd() };
        for (let index = 0; index < argv.length; index++) {
            const argument = argv[index];
            if (argument === '--install') options.install = true;
            else if (argument === '--workspace') options.workspace = path.resolve(requireOptionValue(argv, index++));
            else if (argument === '--python') options.python = requireOptionValue(argv, index++);
            else if (argument === '--wheel-dir') options.wheelDirectory = requireOptionValue(argv, index++);
            else throw new Error(`Unexpected argument: ${argument}`);
        }
        const result = setupParser(options);
                const next = result.ready
                        ? undefined
                        : result.abort
                            ? 'Abort DDL interpretation until SQLGlot is installed or the user explicitly selects model-only interpretation.'
                            : result.method === 'model'
                                ? result.fallbackFrom === 'sqlglot'
                                        ? 'Persist the returned DDL parsing fallback, report the warning, and continue with model-only interpretation.'
                                        : 'Interpret DDL directly using the model; do not install or invoke SQLGlot.'
                                : 'Use the saved DDL parsing choice and host consent policy before running setup-ddl-parser.mjs --workspace <workspace> --install.';
                process.stdout.write(`${JSON.stringify({ ...result, ...(next ? { next } : {}) }, null, 2)}\n`);
                return result.ready || (result.method === 'model' && !result.abort) ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
