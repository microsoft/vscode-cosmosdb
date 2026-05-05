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
        return isFile(command) ? command : undefined;
    }

    for (const pathEntry of getPathEntries(env)) {
        for (const candidate of getWindowsCommandCandidates(command, env.PATHEXT)) {
            const candidatePath = path.win32.join(pathEntry, candidate);
            if (isFile(candidatePath)) {
                return candidatePath;
            }
        }
    }

    return undefined;
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
            .find((line) => line.length > 0 && !line.startsWith('@') && /%\*/.test(line));

        const launcherMatch = launcherLine?.match(/^"([^"]+)"\s+%\*$/);
        if (!launcherMatch) {
            return undefined;
        }

        const shimDirectory = path.win32.dirname(commandPath);
        const resolvedTarget = path.win32.resolve(
            shimDirectory,
            launcherMatch[1].replace(/%~dp0/gi, `${shimDirectory}${path.win32.sep}`),
        );

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
