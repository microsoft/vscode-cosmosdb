/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs, getWebviewByPredicate, maximizeWindow, runCommand } from '../fixtures/webviewHelpers';

test('Workload and Scale cards use native radio keyboard navigation, including filtered scenarios', async ({
    vscodeApp,
}) => {
    const vscodeWindow = await vscodeApp.firstWindow();
    await maximizeWindow(vscodeApp);
    await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Open Data Modeler');
    const webview = await getWebviewByPredicate(
        vscodeWindow,
        async (frame) => (await frame.getByRole('radiogroup', { name: 'Workload scenarios' }).count()) > 0,
    );
    try {
        const filter = webview.getByRole('textbox', { name: 'Filter scenarios…' });
        const scenarios = webview.getByRole('radiogroup', { name: 'Workload scenarios' });
        const chat = scenarios.getByRole('radio', { name: 'Chat & Sessions' });
        const orders = scenarios.getByRole('radio', { name: 'Orders & Transactions' });
        const custom = scenarios.getByRole('radio', { name: 'None of these fit' });
        await filter.focus();
        await filter.press('Tab');
        await expect(chat).toBeFocused();
        await expect(chat).toHaveAttribute('type', 'radio');
        await chat.press('Space');
        await expect(chat).toBeChecked();
        await chat.press('ArrowRight');
        await expect(orders).toBeFocused();
        await expect(orders).toBeChecked();
        await orders.press('ArrowLeft');
        await chat.press('ArrowLeft');
        await expect(custom).toBeFocused();
        await expect(custom).toBeChecked();
        await custom.press('ArrowRight');
        await expect(chat).toBeFocused();
        await expect(chat).toBeChecked();
        await expect(chat).toHaveAccessibleName('Chat & Sessions');
        await expect(chat.locator('..').getByText('Chat & Sessions', { exact: true })).toBeVisible();
        await expect(chat.locator('..')).toHaveCSS('outline-style', 'solid');
        await expect(chat.locator('..')).toHaveCSS('outline-width', '2px');
        await chat.press('Tab');
        await expect(webview.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
        await webview.getByRole('button', { name: 'Start', exact: true }).press('Shift+Tab');
        await expect(chat).toBeFocused();

        await filter.fill('transactions');
        await expect(scenarios.getByRole('radio')).toHaveCount(2);
        await filter.press('Tab');
        await expect(orders).toBeFocused();
        await expect(orders).not.toBeChecked();
        const ledger = scenarios.getByRole('radio', { name: 'Financial Ledger' });
        await orders.press('ArrowDown');
        await expect(ledger).toBeFocused();
        await expect(ledger).toBeChecked();
        await filter.fill('no matching workload');
        await expect(webview.getByText('No scenarios match your filter.')).toBeVisible();
        await expect(scenarios).toHaveCount(0);
        await filter.press('Tab');
        await expect(webview.getByRole('button', { name: 'Start', exact: true })).toBeFocused();
        await filter.fill('');
        await filter.press('Tab');
        await expect(ledger).toBeFocused();
        await expect(ledger).toBeChecked();

        await orders.locator('..').getByText('Orders & Transactions', { exact: true }).click();
        await expect(orders).toBeChecked();
        await webview.getByRole('button', { name: 'Start', exact: true }).click();
        await webview.getByRole('tab', { name: 'Scale', exact: true }).click();
        const items = webview.getByRole('radiogroup', { name: 'Items per partition key value' });
        const medium = items.getByRole('radio', { name: '1K – 100K items' });
        const high = items.getByRole('radio', { name: '100K – 1M items' });
        await medium.focus();
        await medium.press('ArrowRight');
        await expect(high).toBeFocused();
        await expect(high).toBeChecked();
        await high.press('Tab');
        const writes = webview.getByRole('radiogroup', { name: 'Write distribution' });
        const even = writes.getByRole('radio', { name: 'Even', exact: true });
        await expect(even).toBeFocused();
        await even.press('ArrowUp');
        const time = writes.getByRole('radio', { name: 'Time-correlated' });
        await expect(time).toBeFocused();
        await expect(time).toBeChecked();
        await time.press('Tab');
        const growth = webview.getByRole('radiogroup', { name: 'Data growth per PK value' });
        const slow = growth.getByRole('radio', { name: 'Grows slowly' });
        await expect(slow).toBeFocused();
        await slow.press('ArrowDown');
        const rapid = growth.getByRole('radio', { name: /^Grows rapidly/ });
        await expect(rapid).toBeFocused();
        await expect(rapid).toBeChecked();
        await rapid.press('Tab');
        const next = webview.getByRole('button', { name: 'Next', exact: true });
        await expect(next).toBeFocused();
        await next.press('Shift+Tab');
        await expect(rapid).toBeFocused();
        await rapid.press('Shift+Tab');
        await expect(time).toBeFocused();
        await time.press('Shift+Tab');
        await expect(high).toBeFocused();
        await expect(high).toBeChecked();
    } finally {
        await closeAllEditorTabs(vscodeWindow);
    }
});
