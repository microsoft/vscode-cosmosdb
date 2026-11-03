/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '../fixtures/vscode';
import { captureWindowScreenshot, closeAllEditorTabs, resizeWindowViewport } from '../fixtures/webviewHelpers';
import { openQueryEditor } from '../fixtures/webviews';

test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
    await resizeWindowViewport(vscodeApp, vscodeWindow, { width: 1920, height: 1200 });
});

test.afterEach(async ({ vscodeWindow }) => {
    await captureWindowScreenshot(vscodeWindow);
    await closeAllEditorTabs(vscodeWindow);
});

const translations = {
    de: {
        run: 'Ausführen',
        saveName: /^Abfrage speichern\.?$/,
        save: 'Speichern',
        openName: /^Öffnen\.?$/,
    },
    ja: {
        run: '実行',
        saveName: /^クエリの保存\.?$/,
        save: '保存',
        openName: /^開く\.?$/,
    },
};

test('translates controls after switching VS Code display language and restarting @queryEditor', async ({
    vscodeWindow,
    displayLanguage,
}) => {
    if (!displayLanguage) throw new Error('Run this spec with the localization-de or localization-ja project.');
    const language = translations[displayLanguage];
    await expect(vscodeWindow.locator('html')).toHaveAttribute('lang', displayLanguage);

    const webview = await openQueryEditor(vscodeWindow);
    const toolbar = webview.getByRole('toolbar').first();
    await expect(toolbar.getByRole('button', { name: language.run, exact: true })).toBeVisible();
    const save = toolbar.getByRole('button', { name: language.saveName });
    await expect(save).toBeVisible();
    await expect(save).toHaveText(language.save);
    await expect(toolbar.getByRole('button', { name: language.openName })).toBeVisible();
    await expect(toolbar.getByRole('button', { name: /^(Run|Save query|Open)\.?$/ })).toHaveCount(0);
});
