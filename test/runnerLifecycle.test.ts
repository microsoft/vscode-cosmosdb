/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMainThread, threadId } from 'node:worker_threads';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

describe('Extension Host runner lifecycle', () => {
    let active = false;
    let disposable: vscode.Disposable;

    beforeAll(() => {
        disposable = vscode.commands.registerCommand('cosmosdb.integration.runnerProbe', () => process.pid);
    });

    beforeEach(() => {
        expect(active).toBe(false);
        active = true;
    });

    afterEach(() => {
        active = false;
    });

    afterAll(async () => {
        disposable.dispose();
        expect(await vscode.commands.getCommands()).not.toContain('cosmosdb.integration.runnerProbe');
        expect(active).toBe(false);
    });

    it('runs on the Extension Host main thread with working test context assertions', async ({ expect }) => {
        expect.assertions(4);
        expect(isMainThread).toBe(true);
        expect(threadId).toBe(0);
        expect(active).toBe(true);
        expect(await vscode.commands.executeCommand('cosmosdb.integration.runnerProbe')).toBe(process.pid);
    });

    it('runs hooks and tests sequentially in the same host', async () => {
        expect(active).toBe(true);
        expect(await vscode.commands.executeCommand('cosmosdb.integration.runnerProbe')).toBe(process.pid);
    });
});
