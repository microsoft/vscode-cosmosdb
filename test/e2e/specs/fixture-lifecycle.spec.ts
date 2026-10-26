/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as vscodeTest } from '../fixtures/vscode';

/* oxlint-disable react-hooks/rules-of-hooks, no-empty-pattern */
async function withoutWindow({}, use: () => Promise<void>): Promise<void> {
    await use();
}
/* oxlint-enable react-hooks/rules-of-hooks, no-empty-pattern */

const test = vscodeTest.extend({
    vscodeApp: [
        async ({ vscodeApp }, use) => {
            // oxlint-disable-next-line react-hooks/rules-of-hooks
            await use(vscodeApp);
        },
        { scope: 'worker' },
    ],
    windowLayout: withoutWindow,
    windowTrace: withoutWindow,
    coverage: withoutWindow,
});

test('cleans up when VS Code exits before worker teardown', async ({ vscodeApp }) => {
    const window = await vscodeApp.firstWindow();
    await window.locator('.monaco-workbench').waitFor({ state: 'attached' });
    const closed = vscodeApp.waitForEvent('close');
    await vscodeApp.evaluate(({ app }) => {
        setTimeout(() => app.exit(0), 100);
    });
    await closed;
});
