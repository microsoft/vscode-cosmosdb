/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cached probing of the CosmosDBShell binary via `--version`.
 *
 * Caching avoids re-spawning the shell on every keystroke (the value is consulted by
 * activation, by the MCP provider's discovery filter, by the language-server bootstrap,
 * etc.). The cache is keyed on the resolved command path and is invalidated whenever
 * the `cosmosDB.shell.path` setting changes.
 */
import * as child from 'child_process';
import { ext } from '../extensionVariables';
import { getCosmosDBShellCommand } from './shellCommand';

type CosmosDBShellSupportInfo = { installed: boolean; version?: string };

const cosmosDBShellSupportCache = new Map<string, CosmosDBShellSupportInfo>();

/**
 * Determines if CosmosDBShell is installed.
 *
 * @returns true, if CosmosDBShell is installed, false otherwise.
 */
export function isCosmosDBShellInstalled(): boolean {
    return getCachedShellSupport().installed;
}

/**
 * Returns the version reported by `CosmosDBShell --version` (e.g. `1.2.3` or
 * `1.2.3-prerelease.45`), or undefined when the shell is not installed or no
 * version could be parsed from its output.
 */
export function getDetectedCosmosDBShellVersion(): string | undefined {
    return getCachedShellSupport().version;
}

/**
 * Clears the cached result of {@link isCosmosDBShellInstalled}.
 * Call this when the shell path configuration changes or the binary may have been installed/removed.
 */
export function invalidateCosmosDBShellSupportCache(): void {
    cosmosDBShellSupportCache.clear();
}

function getCachedShellSupport(): CosmosDBShellSupportInfo {
    const command = getCosmosDBShellCommand();
    const cached = cosmosDBShellSupportCache.get(command);
    if (cached !== undefined) {
        return cached;
    }
    const result = detectCosmosDBShellSupport(command);
    cosmosDBShellSupportCache.set(command, result);
    return result;
}

/**
 * Extracts a SemVer-like version token (e.g. `1.2.3` or `1.2.3-prerelease.4`)
 * from the `--version` output of CosmosDBShell. Returns undefined when no
 * recognizable version token is present.
 */
function parseShellVersion(output: string): string | undefined {
    const match = output.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?)\b/);
    return match?.[1];
}

function detectCosmosDBShellSupport(command: string): CosmosDBShellSupportInfo {
    try {
        const stdout = child.execFileSync(command, ['--version'], {
            windowsHide: true,
            env: {
                ...process.env,
                // CosmosDBShell may use ANSI output libraries (e.g. Spectre.Console).
                // When spawned by VS Code, stdio is typically redirected which can confuse
                // terminal capability detection. Prefer a plain output mode.
                NO_COLOR: '1',
                CLICOLOR: '0',
                TERM: process.env.TERM ?? 'dumb',
            },
        });
        return { installed: true, version: parseShellVersion(stdout.toString('utf8')) };
    } catch (err) {
        const anyErr = err as { stdout?: unknown; stderr?: unknown };
        const stdout =
            typeof anyErr?.stdout === 'string'
                ? anyErr.stdout
                : Buffer.isBuffer(anyErr?.stdout)
                  ? anyErr.stdout.toString('utf8')
                  : '';
        const stderr =
            typeof anyErr?.stderr === 'string'
                ? anyErr.stderr
                : Buffer.isBuffer(anyErr?.stderr)
                  ? anyErr.stderr.toString('utf8')
                  : '';

        // Workaround: CosmosDBShell may print a valid version string but still exit non-zero
        // when ANSI is not available. Treat that as installed.
        const combinedOutput = `${stdout}\n${stderr}`;
        if (/\bCosmos(?:DB)?Shell\b/i.test(combinedOutput)) {
            ext.outputChannel.appendLine(
                'warning: CosmosDBShell "--version" exited non-zero, but returned version output; treating as installed.',
            );
            if (stderr.trim().length > 0) {
                ext.outputChannel.appendLine(stderr.trim());
            }
            return { installed: true, version: parseShellVersion(combinedOutput) };
        }

        ext.outputChannel.appendLine('fail ' + String(err));
        ext.outputChannel.appendLine('while running "' + command + ' --version"');
        if (stdout.trim().length > 0) {
            ext.outputChannel.appendLine('stdout: ' + stdout.trim());
        }
        if (stderr.trim().length > 0) {
            ext.outputChannel.appendLine('stderr: ' + stderr.trim());
        }
        return { installed: false };
    }
}
