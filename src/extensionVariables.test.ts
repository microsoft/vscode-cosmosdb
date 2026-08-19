/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import { describe, expect, it } from 'vitest';
import { ext } from './extensionVariables';

describe('extensionVariables', () => {
    it('resolves rgApiV2Ready when the API is initialized', async () => {
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
});
