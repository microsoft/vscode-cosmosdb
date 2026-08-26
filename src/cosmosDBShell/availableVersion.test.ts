/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { getLatestPackageVersion, notifyAvailableCosmosDBShellUpdate } from './availableVersion';

const globalStateValues = new Map<string, unknown>();

vi.mock('../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                get: vi.fn((key: string) => globalStateValues.get(key)),
                update: vi.fn((key: string, value: unknown) => {
                    globalStateValues.set(key, value);
                    return Promise.resolve();
                }),
            },
        },
        outputChannel: {
            debug: vi.fn(),
            info: vi.fn(),
        },
    },
}));

describe('getLatestPackageVersion', () => {
    it('selects the latest valid stable or prerelease SemVer', () => {
        const index = JSON.stringify({
            versions: ['1.1.150-preview', 'invalid', '1.1.209-preview', '1.1.190-preview'],
        });

        expect(getLatestPackageVersion(index)).toBe('1.1.209-preview');
    });

    it('returns undefined when the response has no valid versions', () => {
        expect(getLatestPackageVersion(JSON.stringify({ versions: ['invalid', 42] }))).toBeUndefined();
        expect(getLatestPackageVersion(JSON.stringify({}))).toBeUndefined();
    });
});

describe('logAvailableCosmosDBShellUpdate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        globalStateValues.clear();
    });

    it('logs and offers an update when NuGet has a newer version', async () => {
        const updateShell = vi.fn();
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Update');

        await notifyAvailableCosmosDBShellUpdate('1.1.150-preview', false, updateShell, async () => ({
            status: 200,
            bodyAsText: JSON.stringify({ versions: ['1.1.150-preview', '1.1.209-preview'] }),
        }));

        expect(ext.outputChannel.info).toHaveBeenCalledWith(
            'A newer Cosmos DB Shell version is available: 1.1.209-preview (installed: 1.1.150-preview). To update, run: dotnet tool update --global CosmosDBShell --prerelease',
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'A newer Cosmos DB Shell version is available: 1.1.209-preview (installed: 1.1.150-preview).',
            'Update',
        );
        expect(updateShell).toHaveBeenCalledOnce();
    });

    it('opens settings instead of updating when a custom shell path is configured', async () => {
        const updateShell = vi.fn();
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Open Settings');

        await notifyAvailableCosmosDBShellUpdate('1.1.150-preview', true, updateShell, async () => ({
            status: 200,
            bodyAsText: JSON.stringify({ versions: ['1.1.150-preview', '1.1.209-preview'] }),
        }));

        expect(ext.outputChannel.info).toHaveBeenCalledWith(
            'A newer Cosmos DB Shell version is available: 1.1.209-preview (installed: 1.1.150-preview). A custom Cosmos DB Shell path is configured; update that installation manually.',
        );
        expect(updateShell).not.toHaveBeenCalled();
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'workbench.action.openSettings',
            'cosmosDB.shell.path',
        );
    });

    it('shows a notification only once for each available version', async () => {
        const request = async () => ({
            status: 200,
            bodyAsText: JSON.stringify({ versions: ['1.1.150-preview', '1.1.209-preview'] }),
        });

        await notifyAvailableCosmosDBShellUpdate('1.1.150-preview', false, vi.fn(), request);
        await notifyAvailableCosmosDBShellUpdate('1.1.150-preview', false, vi.fn(), request);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
    });

    it('does not update when the notification is dismissed', async () => {
        const updateShell = vi.fn();
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

        await notifyAvailableCosmosDBShellUpdate('1.1.150-preview', false, updateShell, async () => ({
            status: 200,
            bodyAsText: JSON.stringify({ versions: ['1.1.150-preview', '1.1.209-preview'] }),
        }));

        expect(updateShell).not.toHaveBeenCalled();
    });

    it('does not log an update when the installed version is current or newer', async () => {
        await notifyAvailableCosmosDBShellUpdate('1.1.209-preview', false, vi.fn(), async () => ({
            status: 200,
            bodyAsText: JSON.stringify({ versions: ['1.1.150-preview', '1.1.209-preview'] }),
        }));

        expect(ext.outputChannel.info).not.toHaveBeenCalled();
    });

    it('logs lookup failures at debug level without throwing', async () => {
        await expect(
            notifyAvailableCosmosDBShellUpdate('1.1.150-preview', false, vi.fn(), async () => {
                throw new Error('proxy unavailable');
            }),
        ).resolves.toBeUndefined();

        expect(ext.outputChannel.debug).toHaveBeenCalledWith(
            'Unable to check for Cosmos DB Shell updates: Error: proxy unavailable',
        );
    });

    it('does not request NuGet when the installed version is unknown', async () => {
        const request = vi.fn();

        await notifyAvailableCosmosDBShellUpdate(undefined, false, vi.fn(), request);

        expect(request).not.toHaveBeenCalled();
    });
});
