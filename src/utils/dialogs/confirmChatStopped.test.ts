/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { confirmChatStopped } from './confirmChatStopped';

describe('confirmChatStopped', () => {
    beforeEach(() => vi.clearAllMocks());

    it.each([true, false])('shares the local-only native confirmation across Chat workflows: %s', async (confirmed) => {
        vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(
            confirmed ? ('Agent Has Stopped' as never) : undefined,
        );
        await expect(confirmChatStopped()).resolves.toBe(confirmed);
        expect(vscode.window.showWarningMessage).toHaveBeenCalledExactlyOnceWith(
            'Confirm that the agent has already stopped in Chat. This only clears local run tracking; it does not cancel Chat.',
            { modal: true },
            'Agent Has Stopped',
        );
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('propagates dialog failures to the calling workflow', async () => {
        const error = new Error('Dialog unavailable');
        vi.mocked(vscode.window.showWarningMessage).mockRejectedValueOnce(error);
        await expect(confirmChatStopped()).rejects.toBe(error);
    });
});
