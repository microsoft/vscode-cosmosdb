/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('extensionVariables', () => {
    beforeEach(() => vi.resetModules());

    it('resolves rgApiV2Ready when the API is initialized', async () => {
        const { ext } = await import('./extensionVariables');
        const api = {} as AzureResourcesExtensionApiWithActivity;
        let isReady = false;
        const ready = ext.rgApiV2Ready.then((resolvedApi) => {
            isReady = true;
            return resolvedApi;
        });

        await Promise.resolve();
        expect(isReady).toBe(false);

        ext.rgApiV2 = api;

        await expect(ready).resolves.toBe(api);
        expect(ext.rgApiV2).toBe(api);
    });

    it('settles rgApiV2Ready when the API is unavailable', async () => {
        const { ext } = await import('./extensionVariables');

        ext.setRgApiV2Unavailable();

        await expect(ext.rgApiV2Ready).resolves.toBeUndefined();
        expect(() => ext.rgApiV2).toThrow("[ext] 'rgApiV2' unavailable.");
    });
});
