/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type DiagnosticsState } from './model';
import { renderJsonReport, renderReport } from './presentation';
import { copyDiagnosticsReport, saveDiagnosticsReport, showDiagnosticsReport } from './reportActions';

const io = vi.hoisted(() => ({
    clipboard: vi.fn(),
    openReadOnly: vi.fn(),
    saveDialog: vi.fn(),
    writeFile: vi.fn(),
    workspaceUri: { scheme: 'file', path: '/workspace' },
}));
vi.mock('@microsoft/vscode-azext-utils', () => ({ openReadOnlyContent: io.openReadOnly }));
vi.mock('vscode', () => ({
    env: { clipboard: { writeText: io.clipboard } },
    window: { showSaveDialog: io.saveDialog },
    workspace: { workspaceFolders: [{ uri: io.workspaceUri }], fs: { writeFile: io.writeFile } },
    Uri: { file: vi.fn(), joinPath: vi.fn() },
}));

const completed: DiagnosticsState = {
    kind: 'azure',
    connectionName: 'private account',
    phase: 'completed',
    checks: [
        {
            step: 'accountSettings',
            status: 'passed',
            finding: 'settingsRead',
            network: {
                publicAccess: 'enabled',
                ipRules: 1,
                vnetRules: 0,
                vnetFilterEnabled: false,
                privateEndpoints: 0,
                localAuthDisabled: false,
            },
        },
        { step: 'access', status: 'failed', finding: 'firewallPublic', observedClientIp: '203.0.113.10' },
    ],
    trace: { runId: 'run-id', lines: ['sdk target=configured operation=listDatabases status=403'] },
};

beforeEach(() => vi.resetAllMocks());

it('opens a read-only editor with the same redacted Markdown that copy and save produce', async () => {
    const destination = { scheme: 'file', path: '/test.md' };
    io.saveDialog.mockResolvedValue(destination);
    expect(await copyDiagnosticsReport(completed)).toBe('done');
    expect(await saveDiagnosticsReport(completed)).toBe('done');
    expect(await showDiagnosticsReport(completed)).toBe('done');
    const expected = renderReport(completed);
    expect(expected).toContain('sdk target=configured operation=listDatabases status=403');
    expect(expected).not.toContain('203.0.113.10');
    expect(expected).not.toContain('private account');
    expect(io.openReadOnly).toHaveBeenCalledExactlyOnceWith(
        { label: 'Connection Diagnostics', fullId: 'cosmosDiagnostics-run-id' },
        expected,
        '.md',
    );
    expect(io.clipboard).toHaveBeenCalledExactlyOnceWith(expected);
    expect(io.writeFile).toHaveBeenCalledExactlyOnceWith(destination, new TextEncoder().encode(expected));
    expect(vscode.Uri.joinPath).toHaveBeenCalledWith(io.workspaceUri, 'cosmos-db-connection-diagnostics.md');
});

it('saves structured JSON without the local account name or IP address', async () => {
    const destination = { scheme: 'file', path: '/test.JSON' };
    io.saveDialog.mockResolvedValue(destination);
    expect(await saveDiagnosticsReport(completed)).toBe('done');
    const json = renderJsonReport(completed);
    expect(json).toContain('"finding": "firewallPublic"');
    expect(json).toContain('"ipRules": 1');
    expect(json).not.toMatch(/private account|203\.0\.113\.10/);
    expect(io.writeFile).toHaveBeenCalledExactlyOnceWith(destination, new TextEncoder().encode(json));
});

it('does not export running checks or write a file when the save dialog was dismissed', async () => {
    const running: DiagnosticsState = { ...completed, phase: 'running' };
    expect(await copyDiagnosticsReport(running)).toBe('unavailable');
    expect(await saveDiagnosticsReport(running)).toBe('unavailable');
    expect(await showDiagnosticsReport(running)).toBe('unavailable');
    expect(io.clipboard).not.toHaveBeenCalled();
    expect(io.saveDialog).not.toHaveBeenCalled();
    expect(io.openReadOnly).not.toHaveBeenCalled();

    io.saveDialog.mockResolvedValue(undefined);
    expect(await saveDiagnosticsReport(completed)).toBe('cancelled');
    expect(io.writeFile).not.toHaveBeenCalled();
});

it('returns a bounded failure state instead of exposing the native error or path', async () => {
    io.clipboard.mockRejectedValue(new Error('clipboard not available'));
    io.openReadOnly.mockRejectedValue(new Error('could not open /private/user/file.md'));
    io.saveDialog.mockResolvedValue({ path: '/private/user/file.txt' });
    io.writeFile.mockRejectedValue(new Error('permission denied: /private/user/file.txt'));
    await expect(copyDiagnosticsReport(completed)).resolves.toBe('failed');
    await expect(showDiagnosticsReport(completed)).resolves.toBe('failed');
    await expect(saveDiagnosticsReport(completed)).resolves.toBe('failed');
});
