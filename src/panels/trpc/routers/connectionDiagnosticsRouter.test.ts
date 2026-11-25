/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type DiagnosticsState } from '../../../connectionDiagnostics/model';
import { connectionDiagnosticsRouter } from './connectionDiagnosticsRouter';

const mocks = vi.hoisted(() => ({
    track: vi.fn(),
    show: vi.fn(),
    preview: vi.fn(),
    copy: vi.fn(),
    save: vi.fn(),
    openExternal: vi.fn(),
}));

vi.mock('vscode', () => ({ env: { openExternal: mocks.openExternal }, Uri: { parse: (url: string) => url } }));
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: async (
        event: string,
        invoke: (context: Pick<IActionContext, 'telemetry' | 'valuesToMask' | 'errorHandling'>) => Promise<unknown>,
    ) => {
        const context = {
            errorHandling: { issueProperties: {} },
            telemetry: { measurements: {}, properties: {} },
            valuesToMask: [],
        };
        const result = await invoke(context);
        mocks.track(event, context.telemetry);
        return result;
    },
}));
vi.mock('../../../extensionVariables', () => ({
    ext: { outputChannel: { show: mocks.show, debug: vi.fn(), warn: vi.fn() } },
}));
vi.mock('../../../connectionDiagnostics/reportActions', () => ({
    copyDiagnosticsReport: mocks.copy,
    saveDiagnosticsReport: mocks.save,
    showDiagnosticsReport: mocks.preview,
}));

const state: DiagnosticsState = {
    kind: 'azure',
    phase: 'completed',
    checks: [{ step: 'access', status: 'failed', finding: 'firewallPublic', observedClientIp: '203.0.113.10' }],
    trace: { runId: 'run-id', lines: [] },
};

beforeEach(() => vi.resetAllMocks());

it('tracks explicit actions and export outcomes but does not emit events for progress polling', async () => {
    const rerun = vi.fn();
    const cancel = vi.fn();
    const caller = connectionDiagnosticsRouter.createCaller({
        getState: () => state,
        rerun,
        cancel,
        addDataRole: vi.fn(),
    });
    mocks.copy.mockResolvedValue('done');
    mocks.preview.mockResolvedValue('done');
    mocks.save.mockResolvedValue('cancelled');

    await expect(caller.state()).resolves.toEqual(state);
    await expect(caller.state()).resolves.toEqual(state);
    expect(mocks.track).not.toHaveBeenCalled();

    await caller.showOutput();
    expect(mocks.show).toHaveBeenCalledExactlyOnceWith(true);
    await caller.cancel();
    expect(cancel).toHaveBeenCalledOnce();
    await caller.rerun();
    expect(rerun).toHaveBeenCalledOnce();
    await expect(caller.showReport()).resolves.toBe('done');
    await expect(caller.copy()).resolves.toBe('done');
    await expect(caller.save()).resolves.toBe('cancelled');
    expect(mocks.track.mock.calls.map(([event]) => event)).toEqual([
        'cosmosDB.rpc.mutation.connectionDiagnostics.showOutput',
        'cosmosDB.rpc.mutation.connectionDiagnostics.cancel',
        'cosmosDB.rpc.mutation.connectionDiagnostics.rerun',
        'cosmosDB.rpc.mutation.connectionDiagnostics.showReport',
        'cosmosDB.rpc.mutation.connectionDiagnostics.copy',
        'cosmosDB.rpc.mutation.connectionDiagnostics.save',
    ]);
    expect(mocks.track).toHaveBeenLastCalledWith(
        'cosmosDB.rpc.mutation.connectionDiagnostics.save',
        expect.objectContaining({
            maskEntireErrorMessage: true,
            properties: { diagnosticsRunId: 'run-id', reportOutcome: 'cancelled', result: 'Canceled' },
        }),
    );
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain('203.0.113.10');
});

it('only handles role requests for a current, eligible RBAC finding', async () => {
    const runId = 'f89e099d-3d03-46b0-b36d-d0ab4eaa81af';
    let current: DiagnosticsState = { ...state, trace: { runId, lines: [] }, canAddDataRole: true };
    const addDataRole = vi.fn().mockResolvedValue('assigned');
    const caller = connectionDiagnosticsRouter.createCaller({
        getState: () => current,
        rerun: vi.fn(),
        cancel: vi.fn(),
        addDataRole,
    });

    await expect(caller.addDataRole({ runId })).resolves.toBe('unavailable');
    current = { ...current, checks: [{ step: 'access', status: 'info', finding: 'dataRbac' }] };
    await expect(caller.addDataRole({ runId: '8ff951bf-6c50-4130-b529-8af6db41373a' })).resolves.toBe('unavailable');
    expect(addDataRole).not.toHaveBeenCalled();
    await expect(caller.addDataRole({ runId })).resolves.toBe('assigned');
    expect(addDataRole).toHaveBeenCalledExactlyOnceWith(runId, expect.any(Object));
    expect(mocks.track).toHaveBeenLastCalledWith(
        'cosmosDB.rpc.mutation.connectionDiagnostics.addDataRole',
        expect.objectContaining({ properties: { diagnosticsRunId: runId, roleActionOutcome: 'assigned' } }),
    );
});

it('opens an allowlisted help topic and never opens an arbitrary URL', async () => {
    mocks.openExternal.mockResolvedValue(true);
    const caller = connectionDiagnosticsRouter.createCaller({
        getState: () => state,
        rerun: vi.fn(),
        cancel: vi.fn(),
        addDataRole: vi.fn(),
    });
    await expect(caller.openHelp('forbidden')).resolves.toBe(true);
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
        vscode.Uri.parse('https://learn.microsoft.com/azure/cosmos-db/troubleshoot-forbidden'),
    );
    // tRPC callers are typed; simulate an invalid payload arriving from a webview.
    // @ts-expect-error This is not an allowed diagnostics help topic.
    await expect(caller.openHelp('https://example.test')).rejects.toThrow();
    expect(mocks.openExternal).toHaveBeenCalledOnce();
    mocks.openExternal.mockRejectedValueOnce(new Error('unshareable browser error'));
    await expect(caller.openHelp('privateLink')).resolves.toBe(false);
    expect(mocks.track).toHaveBeenLastCalledWith(
        'cosmosDB.rpc.mutation.connectionDiagnostics.openHelp',
        expect.objectContaining({ properties: { result: 'Failed' } }),
    );
});
