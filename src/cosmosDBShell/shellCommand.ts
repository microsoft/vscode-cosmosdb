/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Low-level primitives for locating and launching the CosmosDBShell binary.
 * Kept dependency-light so they can be reused by every other module in this folder.
 */
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { SettingsService } from '../services/SettingsService';
import { SETTING_SHELL_PATH } from './constants';
import { resolveCosmosDBShellCommand } from './cosmosDBShellCommandResolver';

/**
 * Resolves the user-configured Cosmos DB Shell command (or the default `cosmosdbshell`)
 * to a runnable executable path. Delegates Windows PATH/.cmd shim resolution to
 * {@link resolveCosmosDBShellCommand}.
 */
export function getCosmosDBShellCommand(): string {
    const shellPath: string | undefined = SettingsService.getSetting<string>(SETTING_SHELL_PATH);
    return resolveCosmosDBShellCommand(shellPath);
}

/**
 * Returns true when the user has configured a shell path and that path points at an
 * existing file on disk. Used to differentiate "missing binary" from "misconfigured path"
 * when surfacing the install/repair prompt.
 */
export function isCosmosDBShellPathFound(): boolean {
    const shellPath: string | undefined = SettingsService.getSetting<string>(SETTING_SHELL_PATH);
    if (!shellPath?.trim()) {
        return false;
    }

    const trimmed = shellPath.trim();
    const unquoted =
        (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
            ? trimmed.slice(1, -1)
            : trimmed;

    try {
        return fs.existsSync(unquoted) && fs.statSync(unquoted).isFile();
    } catch {
        return false;
    }
}

/**
 * Watches for the terminal closing shortly after creation (early exit).
 * If the process exits quickly, logs the exit code and reason to the output channel.
 */
export function watchForEarlyExit(terminal: vscode.Terminal): void {
    const startTime = Date.now();
    const listener = vscode.window.onDidCloseTerminal((closedTerminal) => {
        if (closedTerminal !== terminal) {
            return;
        }

        clearTimeout(timeout);
        listener.dispose();
        if (Date.now() - startTime < 5000) {
            const exitCode = closedTerminal.exitStatus?.code;
            const exitReason = closedTerminal.exitStatus?.reason;
            ext.outputChannel.error(
                `Cosmos DB Shell exited early.${exitCode !== undefined ? ` Exit code: ${exitCode}.` : ''}${exitReason !== undefined ? ` Reason: ${exitReason}.` : ''}`,
            );
        }
    });
    const timeout = setTimeout(() => {
        listener.dispose();
    }, 5000);
}

/**
 * Quotes a value for use as a single argument inside an interactive Cosmos DB Shell
 * command (sent via `terminal.sendText`). Wraps values containing whitespace, quotes, or
 * backslashes in double quotes and applies C-style escapes (`\\` and `\"`) so the
 * argument is preserved verbatim when parsed by the shell.
 *
 * Backslashes are escaped before quotes so the substitutions don't compound (e.g. a
 * literal `\"` in the input becomes `\\\"` in the output, not `\\"` which would be
 * parsed as `\` followed by an argument-terminating quote).
 */
export function quoteArg(value: string): string {
    return /[\s"'\\]/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value;
}
