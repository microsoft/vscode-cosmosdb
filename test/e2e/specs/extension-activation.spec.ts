/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '../fixtures/vscode';
import { waitForExtensionsActivated } from '../setup/activation';

test.use({ layout: { primarySideBar: true } });

test('keeps an already active Azure sidebar open during the activation handshake', async ({ vscodeWindow }) => {
    const sidebar = vscodeWindow.locator('.part.sidebar');
    await expect(sidebar).toBeVisible();
    await expect(
        vscodeWindow.locator('.part.activitybar').getByRole('tab', { name: /^Azure(?: \(|$)/ }),
    ).toHaveAttribute('aria-selected', 'true');

    await waitForExtensionsActivated(vscodeWindow);

    await expect(sidebar).toBeVisible();
    await expect(vscodeWindow.getByRole('treeitem', { name: 'Cosmos DB Accounts' })).toBeVisible();
});

test('reopens a hidden Azure sidebar during the activation handshake', async ({ vscodeWindow }) => {
    await vscodeWindow
        .locator('.part.activitybar')
        .getByRole('tab', { name: /^Azure(?: \(|$)/ })
        .click();
    await expect(vscodeWindow.locator('.part.sidebar')).toBeHidden();

    await waitForExtensionsActivated(vscodeWindow);

    await expect(vscodeWindow.getByRole('treeitem', { name: 'Cosmos DB Accounts' })).toBeVisible();
});
