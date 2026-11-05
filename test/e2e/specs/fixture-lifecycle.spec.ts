/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { once } from 'node:events';
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

test.afterEach(({ vscodeApp }) => {
    vscodeApp.process = () => {
        throw new Error('The Electron process lookup is no longer available.');
    };
});

test('cleans up when VS Code exits before worker teardown', async ({ vscodeApp, vscodeWindow }) => {
    await vscodeWindow.locator('.monaco-workbench').waitFor({ state: 'visible' });
    // Helpers may retain inherited stdio after exit; releasing those pipes belongs to worker teardown.
    const exited = once(vscodeApp.process(), 'exit');
    await vscodeApp.evaluate(({ app }) => {
        setTimeout(() => app.exit(0), 100);
    });
    await exited;
});
