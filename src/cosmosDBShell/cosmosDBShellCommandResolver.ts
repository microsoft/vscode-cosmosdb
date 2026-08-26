/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { isWindows } from '../constants';

const defaultCosmosDBShellCommand = 'cosmosdbshell';

export function resolveCosmosDBShellCommand(
    shellPath: string | undefined,
    env: NodeJS.ProcessEnv = process.env,
    isWindowsPlatform: boolean = isWindows,
): string {
    const command = getConfiguredCosmosDBShellCommand(shellPath);

    if (!isWindowsPlatform) {
        return command;
    }

    const resolvedCommand = resolveWindowsCommand(command, env);
    if (!resolvedCommand) {
        return command;
    }

    return resolveWindowsDotnetToolShim(resolvedCommand) ?? resolvedCommand;
}

function getConfiguredCosmosDBShellCommand(shellPath: string | undefined): string {
    const trimmedShellPath = shellPath?.trim();
    if (!trimmedShellPath) {
        return defaultCosmosDBShellCommand;
    }

    return stripWrappingQuotes(trimmedShellPath);
}

function stripWrappingQuotes(value: string): string {
    return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
}

function resolveWindowsCommand(command: string, env: NodeJS.ProcessEnv): string | undefined {
    if (isExplicitPath(command)) {
        return selectWindowsCommand(getWindowsCommandCandidates(command, env.PATHEXT));
    }

    for (const pathEntry of getPathEntries(env)) {
        const candidates = getWindowsCommandCandidates(command, env.PATHEXT).map((candidate) =>
            path.win32.join(pathEntry, candidate),
        );
        const selectedCommand = selectWindowsCommand(candidates);
        if (selectedCommand) {
            return selectedCommand;
        }
    }

    return undefined;
}

// Prefers a `.cmd`/`.bat` dotnet tool shim over a same-named `.exe` in the same directory,
// even though PATHEXT would pick the `.exe` first: `dotnet tool update` rewrites the shim to
// point at the new versioned payload but can leave a stale root `.exe` behind.
function selectWindowsCommand(candidates: string[]): string | undefined {
    const existingCandidates = candidates.filter(isFile);
    for (const candidate of existingCandidates) {
        const shimTarget = resolveWindowsDotnetToolShim(candidate);
        if (shimTarget) {
            return shimTarget;
        }
    }
    return existingCandidates[0];
}

function isExplicitPath(command: string): boolean {
    return path.win32.isAbsolute(command) || command.includes('\\') || command.includes('/');
}

function getPathEntries(env: NodeJS.ProcessEnv): string[] {
    return (env.PATH ?? '')
        .split(path.win32.delimiter)
        .map((entry) => stripWrappingQuotes(entry.trim()))
        .filter((entry) => entry.length > 0);
}

function getWindowsCommandCandidates(command: string, pathExt: string | undefined): string[] {
    if (path.win32.extname(command)) {
        return [command];
    }

    const extensions = (pathExt ?? '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .map((extension) => extension.trim())
        .filter((extension) => extension.length > 0);

    return extensions.map((extension) => command + (extension.startsWith('.') ? extension : `.${extension}`));
}

function resolveWindowsDotnetToolShim(commandPath: string): string | undefined {
    if (!/\.(cmd|bat)$/i.test(commandPath)) {
        return undefined;
    }

    try {
        const shimContents = fs.readFileSync(commandPath, 'utf8');
        const launcherLine = shimContents
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0 && !line.startsWith('@') && line.includes('%*'));

        const launcherMatch = launcherLine?.match(/^"([^"]+)"\s+%\*$/);
        if (!launcherMatch) {
            return undefined;
        }

        const shimDirectory = path.win32.dirname(commandPath);
        const resolvedTarget = path.win32.resolve(
            shimDirectory,
            launcherMatch[1].replace(/%~dp0/gi, `${shimDirectory}${path.win32.sep}`),
        );
        const storeDirectory = path.win32.join(shimDirectory, '.store');
        const relativeTarget = path.win32.relative(storeDirectory, resolvedTarget);
        if (relativeTarget.startsWith('..') || path.win32.isAbsolute(relativeTarget)) {
            return undefined;
        }

        return isFile(resolvedTarget) ? resolvedTarget : undefined;
    } catch {
        return undefined;
    }
}

function isFile(filePath: string): boolean {
    try {
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
}
