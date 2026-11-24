/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '../fixtures/vscode';
import {
    closeAllEditorTabs,
    getWebviewByPredicate,
    resetNativeDialogStubs,
    runCommand,
    stubMessageBoxButton,
} from '../fixtures/webviewHelpers';

test('opens the managed emulator webview and offers both engines', async ({ vscodeWindow }) => {
    try {
        await runCommand(vscodeWindow, 'Cosmos DB: Set up Azure Cosmos DB Emulator');
        const wizard = await getWebviewByPredicate(vscodeWindow, async (frame) =>
            frame.getByRole('heading', { name: 'Introduction' }).isVisible(),
        );
        const next = wizard.getByRole('button', { name: 'Continue' });
        await expect(next).toHaveText('Continue');
        await expect(next).toHaveAccessibleName('Continue');
        await next.click();
        await expect(wizard.getByRole('heading', { name: 'Configure' })).toBeFocused();
        await expect(wizard.getByRole('radio', { name: 'Docker', exact: true })).toBeVisible();
        await expect(wizard.getByRole('radio', { name: 'Podman', exact: true })).toBeVisible();
        await expect(wizard.getByRole('spinbutton', { name: 'Cosmos DB endpoint port' })).toHaveValue('8081');
        await expect(wizard.getByRole('spinbutton', { name: 'Data Explorer port' })).toHaveValue('1234');
    } finally {
        await closeAllEditorTabs(vscodeWindow);
    }
});

const selectedEngine = process.env.COSMOSDB_MANAGED_TEST_ENGINE;
const engineLabel = selectedEngine === 'podman' ? 'Podman' : 'Docker';

test('creates and browses a managed emulator without asking for credentials', async ({ vscodeApp, vscodeWindow }) => {
    test.skip(selectedEngine !== 'docker' && selectedEngine !== 'podman', 'Requires a live container engine');
    test.setTimeout(20 * 60_000);
    const row = vscodeWindow.locator('.monaco-list-row[aria-label^="Azure Cosmos DB Emulator (NoSQL)"]').first();
    try {
        await runCommand(vscodeWindow, 'Cosmos DB: Set up Azure Cosmos DB Emulator');
        const wizard = await getWebviewByPredicate(vscodeWindow, async (frame) =>
            frame.getByRole('heading', { name: 'Introduction' }).isVisible(),
        );
        await wizard.getByRole('button', { name: 'Continue' }).click();
        const engine = wizard.getByRole('radio', { name: engineLabel, exact: true });
        await engine.check();
        await expect(engine).toBeChecked();
        await wizard.getByRole('spinbutton', { name: 'Cosmos DB endpoint port' }).fill('18082');
        await wizard.getByRole('spinbutton', { name: 'Data Explorer port' }).fill('11235');
        const start = wizard.getByRole('button', { name: 'Start setup' });
        await expect(start).toHaveText('Start setup');
        await expect(start).toHaveAccessibleName('Start setup');
        await start.click();
        const done = wizard.getByRole('heading', { name: 'Done' });
        const error = wizard.getByRole('alert');
        await expect(done.or(error).first()).toBeVisible({ timeout: 17 * 60_000 });
        if (await error.isVisible()) {
            throw new Error(`${engineLabel} setup failed: ${await error.innerText()}`);
        }
        await expect(done).toBeVisible();
        const open = wizard.getByRole('button', { name: 'Open connection' });
        await expect(open).toHaveText('Open connection');
        await expect(open).toHaveAccessibleName('Open connection');
        await open.click();
        await expect(row).toBeVisible();
        await expect(vscodeWindow.locator('.monaco-list-row[aria-label^="Create Database"]').first()).toBeVisible();
    } finally {
        try {
            if (await row.isVisible()) {
                await stubMessageBoxButton(vscodeApp, '^Delete emulator and data$');
                await row.click({ button: 'right' });
                const remove = vscodeWindow
                    .locator('.context-view .monaco-menu')
                    .getByText('Delete Emulator…', { exact: true });
                await remove.hover();
                await vscodeWindow.keyboard.press('Enter');
                await expect(row).toHaveCount(0);
            }
        } finally {
            await resetNativeDialogStubs(vscodeApp);
            await closeAllEditorTabs(vscodeWindow);
        }
    }
});
