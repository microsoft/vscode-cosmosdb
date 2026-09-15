/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* oxlint-disable react-hooks/rules-of-hooks, no-empty-pattern */

import { expect } from '@playwright/test';
import { test as base } from '../fixtures/vscode';
import { waitForExtensionsActivated } from '../setup/activation';

// Exercise worker startup without first running the activation-dependent auto fixtures.
const test = base.extend({
    windowLayout: async ({}, use) => use(),
    windowTrace: async ({}, use) => use(),
    coverage: async ({}, use) => use(),
});

test('activation waits for Azure registration instead of running a similar command', async ({ vscodeApp }) => {
    await vscodeApp.firstWindow();
    const newWindow = vscodeApp.waitForEvent('window');
    const browserWindow = await vscodeApp.evaluateHandle(({ BrowserWindow }) => new BrowserWindow({ show: false }));
    await browserWindow.evaluate((window) => window.loadURL('about:blank'));
    const page = await newWindow;
    try {
        await page.setContent(`
            <div class="quick-input-widget"><input /></div>
            <div class="quick-input-list">
                <button class="monaco-list-row">View: Show Single Editor Tab</button>
            </div>
        `);
        const activation = waitForExtensionsActivated(page);
        // Closing the page after a failed assertion also rejects the outstanding activation wait.
        void activation.catch(() => {});
        await page.evaluate(() => {
            const azure = document.createElement('button');
            azure.setAttribute('role', 'tab');
            azure.setAttribute('aria-label', 'Azure (Ctrl+Shift+A)');
            azure.textContent = 'Azure';
            azure.onclick = () => {
                const account = document.createElement('div');
                account.setAttribute('role', 'treeitem');
                account.textContent = 'Cosmos DB Accounts';
                document.body.append(account);
            };
            document.body.append(azure);
        });

        await expect(page.getByRole('treeitem', { name: 'Cosmos DB Accounts' })).toBeVisible({ timeout: 3_000 });
        await activation;
    } finally {
        await page.close();
        await browserWindow.dispose();
    }
});
