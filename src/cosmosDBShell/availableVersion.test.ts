/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ext } from '../extensionVariables';
import { getLatestPackageVersion, logAvailableCosmosDBShellUpdate } from './availableVersion';

vi.mock('../extensionVariables', () => ({
    ext: {
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
    });

    it('logs an informational note when NuGet has a newer version', async () => {
        await logAvailableCosmosDBShellUpdate('1.1.150-preview', false, async () => ({
            status: 200,
            bodyAsText: JSON.stringify({ versions: ['1.1.150-preview', '1.1.209-preview'] }),
        }));

        expect(ext.outputChannel.info).toHaveBeenCalledWith(
            'A newer Cosmos DB Shell version is available: 1.1.209-preview (installed: 1.1.150-preview). To update, run: dotnet tool update --global CosmosDBShell --prerelease',
        );
    });

    it('provides manual guidance when a custom shell path is configured', async () => {
        await logAvailableCosmosDBShellUpdate('1.1.150-preview', true, async () => ({
            status: 200,
            bodyAsText: JSON.stringify({ versions: ['1.1.150-preview', '1.1.209-preview'] }),
        }));

        expect(ext.outputChannel.info).toHaveBeenCalledWith(
            'A newer Cosmos DB Shell version is available: 1.1.209-preview (installed: 1.1.150-preview). A custom Cosmos DB Shell path is configured; update that installation manually.',
        );
    });

    it('does not log an update when the installed version is current or newer', async () => {
        await logAvailableCosmosDBShellUpdate('1.1.209-preview', false, async () => ({
            status: 200,
            bodyAsText: JSON.stringify({ versions: ['1.1.150-preview', '1.1.209-preview'] }),
        }));

        expect(ext.outputChannel.info).not.toHaveBeenCalled();
    });

    it('logs lookup failures at debug level without throwing', async () => {
        await expect(
            logAvailableCosmosDBShellUpdate('1.1.150-preview', false, async () => {
                throw new Error('proxy unavailable');
            }),
        ).resolves.toBeUndefined();

        expect(ext.outputChannel.debug).toHaveBeenCalledWith(
            'Unable to check for Cosmos DB Shell updates: Error: proxy unavailable',
        );
    });

    it('does not request NuGet when the installed version is unknown', async () => {
        const request = vi.fn();

        await logAvailableCosmosDBShellUpdate(undefined, false, request);

        expect(request).not.toHaveBeenCalled();
    });
});
