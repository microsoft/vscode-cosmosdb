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
import { resolveCosmosDBShellCommand } from './cosmosDBShellCommandResolver';

/** Display name used for every Cosmos DB Shell terminal created by this extension. */
export const COSMOS_DB_SHELL_TERMINAL_NAME = 'Cosmos DB Shell';

/**
 * Resolves the user-configured Cosmos DB Shell command (or the default `cosmosdbshell`)
 * to a runnable executable path. Delegates Windows PATH/.cmd shim resolution to
 * {@link resolveCosmosDBShellCommand}.
 */
export function getCosmosDBShellCommand(): string {
    const shellPath: string | undefined = SettingsService.getSetting<string>('cosmosDB.shell.path');
    return resolveCosmosDBShellCommand(shellPath);
}

/**
 * Returns true when the user has configured a shell path and that path points at an
 * existing file on disk. Used to differentiate "missing binary" from "misconfigured path"
 * when surfacing the install/repair prompt.
 */
export function isCosmosDBShellPathFound(): boolean {
    const shellPath: string | undefined = SettingsService.getSetting<string>('cosmosDB.shell.path');
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
 * command (sent via `terminal.sendText`). Only escapes characters that would terminate
 * the argument when parsed by the shell itself.
 */
export function quoteArg(value: string): string {
    return /[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
