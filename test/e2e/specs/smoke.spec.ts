/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs } from '../fixtures/webviewHelpers';
import { openDocument, openMigrationAssistant, openQueryEditor } from '../fixtures/webviews';

/**
 * Smoke coverage for the three React webviews shipped by the extension.
 *
 * Goals (intentionally minimal):
 *   1. A real VS Code launches with our extension loaded from `dist/`.
 *   2. Each panel opens via the right command path (production for Migration;
 *      test-only `cosmosDB.e2e.*` commands for Document/QueryEditor — see
 *      `src/commands/e2eTestCommands/registerE2eTestCommands.ts`).
 *   3. The React tree inside the webview iframe mounts — i.e. `/views.js`
 *      loads, providers render, `#root` gets children.
 *
 * Anything richer (interactions, asserting specific UI, exercising tRPC
 * round-trips) belongs in dedicated specs that build on these fixtures.
 */
test.describe('webview smoke', () => {
    // These tests only care about the webview iframe, so hide all the VS Code
    // chrome that competes for space in the attached screenshots. The Copilot
    // Chat secondary side bar and bottom panel are hidden by default; also drop
    // the primary side bar (Azure tree) here since no test below touches it.
    test.use({ layout: { primarySideBar: false } });

    // Worker-scoped vscodeApp/Window fixtures mean VS Code is reused across
    // tests. Each test must reset editor state itself or panels from one test
    // leak into the next.
    test.afterEach(async ({ vscodeWindow }) => {
        await closeAllEditorTabs(vscodeWindow);
    });

    test('Migration Assistant mounts', async ({ vscodeWindow }) => {
        const webview = await openMigrationAssistant(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();
        await expect(webview.locator('#vscode-ext-webview-fluentui-overrides')).toHaveCount(1);
    });

    test('Query Editor mounts', async ({ vscodeWindow }) => {
        // Connection state depends on env (see `fixtures/webviews.ts`).
        // The mount assertion holds in both modes.
        const webview = await openQueryEditor(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();
    });

    test('Document mounts (add mode)', async ({ vscodeWindow }) => {
        const webview = await openDocument(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();
    });

    test('Fluent and Monaco follow live theme colors without remounting', async ({ vscodeWindow }, testInfo) => {
        const webview = await openDocument(vscodeWindow);
        const editor = webview.locator('.monaco-editor').first();
        const provider = webview.locator('.fui-FluentProvider').first();
        await expect(editor).toBeVisible();
        await expect(provider).toBeVisible();
        await expect(webview.locator('#vscode-ext-webview-fluentui-overrides')).toHaveCount(1);
        const originalEditor = await editor.elementHandle();
        const original = await webview.evaluate(() => ({
            style: document.documentElement.getAttribute('style'),
            kind: document.body.getAttribute('data-vscode-theme-kind'),
        }));

        try {
            for (const theme of [
                { kind: 'vscode-light', base: 'vs', background: '#f0e6f5', rgb: 'rgb(240, 230, 245)' },
                { kind: 'vscode-dark', base: 'vs-dark', background: '#203040', rgb: 'rgb(32, 48, 64)' },
                { kind: 'vscode-high-contrast', base: 'hc-black', background: '#000000', rgb: 'rgb(0, 0, 0)' },
                {
                    kind: 'vscode-high-contrast-light',
                    base: 'hc-light',
                    background: '#ffffff',
                    rgb: 'rgb(255, 255, 255)',
                },
            ]) {
                await webview.evaluate(({ kind, background }) => {
                    document.body.setAttribute('data-vscode-theme-kind', kind);
                    document.documentElement.style.setProperty('--vscode-editor-background', background);
                }, theme);
                await expect(editor).toHaveClass(new RegExp(`(?:^|\\s)${theme.base}(?:\\s|$)`));
                await expect(editor).toHaveCSS('background-color', theme.rgb);
                expect(await editor.evaluate((element, previous) => element === previous, originalEditor)).toBe(true);
                await testInfo.attach(theme.kind, { body: await editor.screenshot(), contentType: 'image/png' });
            }

            await webview.evaluate(() => {
                document.body.setAttribute('data-vscode-theme-kind', 'vscode-dark');
                document.documentElement.style.setProperty('--vscode-button-background', '#0078d4');
                document.documentElement.style.setProperty('--vscode-editor-background', '#203040');
            });
            await expect(editor).toHaveClass(/\bvs-dark\b/);
            await expect(editor).toHaveCSS('background-color', 'rgb(32, 48, 64)');
            const originalBrand = await provider.evaluate((element) =>
                getComputedStyle(element).getPropertyValue('--colorBrandBackground'),
            );

            await webview.evaluate(() => {
                document.documentElement.style.setProperty('--vscode-button-background', '#b03060');
                document.documentElement.style.setProperty('--vscode-editor-background', '#403020');
            });
            await expect(editor).toHaveCSS('background-color', 'rgb(64, 48, 32)');
            await expect(provider).toHaveCSS('background-color', 'rgb(64, 48, 32)');
            await expect
                .poll(() =>
                    provider.evaluate((element) =>
                        getComputedStyle(element).getPropertyValue('--colorBrandBackground'),
                    ),
                )
                .not.toBe(originalBrand);
            expect(await editor.evaluate((element, previous) => element === previous, originalEditor)).toBe(true);
            await expect(webview.locator('#vscode-ext-webview-fluentui-overrides')).toHaveCount(1);
        } finally {
            await webview.evaluate(({ style, kind }) => {
                if (style === null) document.documentElement.removeAttribute('style');
                else document.documentElement.setAttribute('style', style);
                if (kind === null) document.body.removeAttribute('data-vscode-theme-kind');
                else document.body.setAttribute('data-vscode-theme-kind', kind);
            }, original);
            await originalEditor?.dispose();
        }
    });
});
