/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type DiagnosticsState } from './model';
import { renderReport } from './presentation';
import { copyDiagnosticsReport, saveDiagnosticsReport } from './reportActions';

const io = vi.hoisted(() => ({
    clipboard: vi.fn(),
    saveDialog: vi.fn(),
    writeFile: vi.fn(),
    workspaceUri: { scheme: 'file', path: '/workspace' },
}));
vi.mock('vscode', () => ({
    env: { clipboard: { writeText: io.clipboard } },
    window: { showSaveDialog: io.saveDialog },
    workspace: { workspaceFolders: [{ uri: io.workspaceUri }], fs: { writeFile: io.writeFile } },
    Uri: { file: vi.fn(), joinPath: vi.fn() },
}));

const completed: DiagnosticsState = {
    kind: 'azure',
    phase: 'completed',
    checks: [{ step: 'access', status: 'failed', finding: 'firewallPublic', observedClientIp: '203.0.113.10' }],
};

beforeEach(() => vi.resetAllMocks());

it('copies and saves exactly the redacted preview', async () => {
    const destination = { scheme: 'file', path: '/test.txt' };
    io.saveDialog.mockResolvedValue(destination);
    expect(await copyDiagnosticsReport(completed)).toBe('done');
    expect(await saveDiagnosticsReport(completed)).toBe('done');
    const expected = renderReport(completed);
    expect(expected).not.toContain('203.0.113.10');
    expect(io.clipboard).toHaveBeenCalledExactlyOnceWith(expected);
    expect(io.writeFile).toHaveBeenCalledExactlyOnceWith(destination, new TextEncoder().encode(expected));
    expect(vscode.Uri.joinPath).toHaveBeenCalledWith(io.workspaceUri, 'cosmos-db-connection-diagnostics.txt');
});

it('does not export running checks or write a file when the save dialog was dismissed', async () => {
    const running: DiagnosticsState = { ...completed, phase: 'running' };
    expect(await copyDiagnosticsReport(running)).toBe('unavailable');
    expect(await saveDiagnosticsReport(running)).toBe('unavailable');
    expect(io.clipboard).not.toHaveBeenCalled();
    expect(io.saveDialog).not.toHaveBeenCalled();

    io.saveDialog.mockResolvedValue(undefined);
    expect(await saveDiagnosticsReport(completed)).toBe('cancelled');
    expect(io.writeFile).not.toHaveBeenCalled();
});

it('returns a bounded failure state instead of exposing the native error or path', async () => {
    io.clipboard.mockRejectedValue(new Error('clipboard not available'));
    io.saveDialog.mockResolvedValue({ path: '/private/user/file.txt' });
    io.writeFile.mockRejectedValue(new Error('permission denied: /private/user/file.txt'));
    await expect(copyDiagnosticsReport(completed)).resolves.toBe('failed');
    await expect(saveDiagnosticsReport(completed)).resolves.toBe('failed');
});
