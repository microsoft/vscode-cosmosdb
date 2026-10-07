/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs, getWebviewByPredicate, maximizeWindow, runCommand } from '../fixtures/webviewHelpers';

test('invalid container names keep the native input open on Enter', async ({ vscodeApp }) => {
    const vscodeWindow = await vscodeApp.firstWindow();
    await maximizeWindow(vscodeApp);
    await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Open Data Modeler');
    const webview = await getWebviewByPredicate(
        vscodeWindow,
        async (frame) => (await frame.getByRole('radiogroup', { name: 'Workload scenarios' }).count()) > 0,
    );
    try {
        await webview.getByRole('radio', { name: 'Orders & Transactions' }).click();
        await webview.getByRole('button', { name: 'Start', exact: true }).click();
        await webview.getByRole('button', { name: 'Add container', exact: true }).click();
        const input = vscodeWindow.locator('.quick-input-widget input').first();
        const widget = vscodeWindow.locator('.quick-input-widget');
        await expect(input).toBeVisible();
        for (const name of [
            '',
            'bad/name',
            'bad\\name',
            'bad?name',
            'bad#name',
            'bad%name',
            '.',
            '..',
            'x'.repeat(256),
            'Orders',
            'Orders ',
            'New Orders ',
            ' New Orders',
        ]) {
            await input.fill(name);
            await input.press('Enter');
            await expect(input).toBeVisible();
            await expect(input).toHaveValue(name);
            await expect(widget.locator('.quick-input-message')).toContainText(
                /required|cannot|already exists|whitespace/i,
            );
            await input.press('Enter');
            await expect(input).toBeVisible();
        }
        await input.fill('ValidOrders');
        await input.press('Enter');
        await expect(input).toBeHidden();
        await expect(webview.getByRole('button', { name: /Container:\s*ValidOrders/ })).toBeVisible();
        await webview.getByRole('button', { name: 'Add container', exact: true }).click();
        await input.fill('bad/name');
        await input.press('Escape');
        await expect(input).toBeHidden();
        await expect(webview.getByRole('button', { name: 'Add container', exact: true })).toBeEnabled();
    } finally {
        await closeAllEditorTabs(vscodeWindow);
    }
});
