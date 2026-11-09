/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '../fixtures/vscode';

test.use({ displayLanguage: 'de' });

test('cleans up a relaunched VS Code without looking up its process again', async ({ vscodeApp, vscodeWindow }) => {
    await expect(vscodeWindow.locator('html')).toHaveAttribute('lang', 'de');
    vscodeApp.process = () => {
        throw new Error('The Electron process lookup is no longer available.');
    };
});
