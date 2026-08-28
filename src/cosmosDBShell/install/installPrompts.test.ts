/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child from 'child_process';
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { invalidateCosmosDBShellSupportCache } from '../shellSupportCache';
import { hasRequiredDotNetSdk } from './dotNetSdk';
import { promptToResolveMissingCosmosDBShell, updateCosmosDBShell } from './installPrompts';

vi.mock('child_process', () => ({
    spawn: vi.fn(),
}));

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string) => message),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (_eventName: string, callback: (context: unknown) => Promise<unknown>) =>
            callback({
                errorHandling: {},
                telemetry: { properties: {}, measurements: {} },
                valuesToMask: [],
            }),
    ),
}));

vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            append: vi.fn(),
            appendLine: vi.fn(),
            show: vi.fn(),
        },
    },
}));

vi.mock('../shellSupportCache', () => ({
    invalidateCosmosDBShellSupportCache: vi.fn(),
    isCosmosDBShellInstalled: vi.fn(),
}));

vi.mock('../shellCommand', () => ({
    isCosmosDBShellPathFound: vi.fn(),
}));

vi.mock('./dotNetSdk', () => ({
    hasRequiredDotNetSdk: vi.fn(),
    MIN_DOTNET_SDK_VERSION: '10.0.100',
    tryInstallDotNetSdkViaExtension: vi.fn(),
}));

function mockCancelledDotNetTool(exitCode: number | null = null): { kill: Mock } {
    const process = new EventEmitter() as EventEmitter & {
        kill: Mock;
        stdout: EventEmitter;
        stderr: EventEmitter;
    };
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    process.kill = vi.fn(() => {
        queueMicrotask(() => process.emit('close', exitCode));
        return true;
    });
    (child.spawn as Mock).mockReturnValue(process);
    (vscode.window.withProgress as Mock).mockImplementation(
        async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) => {
            let cancel: (() => void) | undefined;
            const result = task(
                {},
                {
                    onCancellationRequested: (listener: () => void) => {
                        cancel = listener;
                        return { dispose: vi.fn() };
                    },
                },
            );
            cancel?.();
            return result;
        },
    );
    return process;
}

describe('Cosmos DB Shell tool operations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not report a failure when the update is cancelled', async () => {
        const process = mockCancelledDotNetTool();

        await updateCosmosDBShell();

        expect(process.kill).toHaveBeenCalledOnce();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(invalidateCosmosDBShellSupportCache).not.toHaveBeenCalled();
        // oxlint-disable-next-line typescript/no-deprecated -- member reference includes a deprecated overload not invoked here
        expect(ext.outputChannel.show).toHaveBeenCalledOnce();
    });

    it('reports success when the process exits successfully after cancellation is requested', async () => {
        const process = mockCancelledDotNetTool(0);

        await updateCosmosDBShell();

        expect(process.kill).toHaveBeenCalledOnce();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Cosmos DB Shell update completed.');
        expect(invalidateCosmosDBShellSupportCache).toHaveBeenCalledOnce();
    });

    it('does not report a failure or launch the shell when installation is cancelled', async () => {
        const launchShell = vi.fn();
        const process = mockCancelledDotNetTool();
        (hasRequiredDotNetSdk as Mock).mockReturnValue(true);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Install');

        await promptToResolveMissingCosmosDBShell({} as never, undefined, launchShell);

        expect(process.kill).toHaveBeenCalledOnce();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(launchShell).not.toHaveBeenCalled();
        expect(invalidateCosmosDBShellSupportCache).not.toHaveBeenCalled();
    });
});
