/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TypedEventSink } from '@microsoft/vscode-ext-webview';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import {
    type MigrationEvent,
    type MigrationEventName,
    type MigrationEventPayloads,
    type MigrationProgressEventName,
} from '../../trpc/routers/migrationEventsRouter';

export function isMigrationWorkspaceRoot(workspacePath: string): boolean {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.length === 1 && path.relative(folders[0].uri.fsPath, workspacePath) === '';
}

// ─── Progress / Events ──────────────────────────────────────────────

export async function sendPhaseProgress<N extends MigrationProgressEventName>(
    channel: TypedEventSink<MigrationEvent>,
    logTag: string,
    eventName: N,
    message: string,
): Promise<void> {
    ext.outputChannel.appendLog(`[${logTag}] ${message}`);
    emitMigrationEvent(channel, eventName, [message] as MigrationEventPayloads[N]);
}

/**
 * Type-safe emit for a single `MigrationEvent`. Use at sites that have a
 * `TypedEventSink<MigrationEvent>` in hand and need to push a named event
 * with strongly-typed params (the compiler enforces `params` matches `name`).
 *
 * The internal cast bridges a TypeScript limitation: the union is
 * discriminated by `type` (always `'event'`), so the compiler cannot
 * narrow object literals by `name` to a single variant.
 */
export function emitMigrationEvent<N extends MigrationEventName>(
    channel: TypedEventSink<MigrationEvent>,
    name: N,
    params: MigrationEventPayloads[N],
): void {
    channel.emit({ type: 'event', name, params } as MigrationEvent);
}
