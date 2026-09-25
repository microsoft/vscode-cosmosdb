/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '@playwright/test';
import scenarios from '../../packages/docs/samples/scenarios.json' with { type: 'json' };

test('documentation navigation and theme work without browser errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Cosmos DB');
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    for (const name of [
        'Getting started',
        'Language Service API',
        'Schema Analyzer API',
        'Monaco',
        'CodeMirror',
        'VS Code',
        'Samples',
        'Limitations',
    ]) {
        await page.locator('.VPSidebar').getByRole('link', { name, exact: true }).click();
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.locator('main')).not.toContainText('PAGE NOT FOUND');
    }
    expect(errors).toEqual([]);
});

test('mobile navigation stays within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('./');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('banner').getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Dark theme', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

for (const editor of ['monaco', 'codemirror'] as const) {
    test(`${editor} applies sample queries immediately without replacing documents or schema`, async ({ page }) => {
        await page.goto('./playground');
        await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
        if (editor === 'codemirror') {
            await page.getByLabel('Editor', { exact: true }).selectOption(editor);
            await expect(page.locator('.cm-content')).toBeVisible();
        }

        const sample = page.getByRole('combobox', { name: 'Sample', exact: true });
        const documents = page.getByLabel('Documents to analyze (a non-empty JSON array of objects)');
        const inferredSchema = page.getByRole('region', { name: 'Inferred schema', exact: true });
        const diagnostics = page.getByRole('region', { name: 'Diagnostics', exact: true });
        const customDocuments = '[{"customField": 42}]';
        await expect(page.locator('label', { hasText: /^Sample$/ })).toHaveText('Sample');
        await expect(sample).toHaveAccessibleName('Sample');
        await expect(sample).toHaveAccessibleDescription(/Selecting a sample replaces only the query/);
        await expect(page.getByRole('button', { name: 'Reset to selected sample', exact: true })).toHaveCount(0);
        await documents.fill(customDocuments);
        await page.getByRole('button', { name: 'Apply schema', exact: true }).click();
        await expect(inferredSchema.locator('code')).toContainText('"customField"');
        const originalSchema = await inferredSchema.locator('code').textContent();

        // Include the initial sample by returning to it after the other three.
        for (const scenario of [...scenarios.slice(1), scenarios[0]]) {
            await sample.focus();
            await sample.selectOption(scenario.id);
            await expect(sample).toBeFocused();
            await expect(page.locator('.status')).toHaveText(
                `Loaded ${scenario.name}. Documents and schema are unchanged.`,
            );
            const lines = page.locator(editor === 'monaco' ? '.view-lines .view-line' : '.cm-content .cm-line');
            await expect
                .poll(async () =>
                    (await lines.allTextContents()).map((line) => line.replace(/\u00a0/g, ' ')).join('\n'),
                )
                .toBe(scenario.query);
            await expect(documents).toHaveValue(customDocuments);
            await expect(inferredSchema.locator('code')).toHaveText(originalSchema ?? '');
            if (scenario.id === 'invalid-sql') {
                await expect(diagnostics.locator('li').first()).toBeVisible();
            } else if (scenario.id === 'nested') {
                await expect(diagnostics).toContainText('No SQL syntax issues found.');
            }
        }

        // Changing samples must not apply, discard, or validate unfinished JSON.
        await documents.fill('{');
        await sample.selectOption('multi-query');
        await expect(documents).toHaveValue('{');
        await expect(inferredSchema.locator('code')).toHaveText(originalSchema ?? '');
        const documentsPanel = page.getByRole('region', { name: 'JSON documents', exact: true });
        await expect(documentsPanel).toContainText('Documents changed.');
        await expect(documentsPanel.getByRole('alert')).toBeEmpty();

        const input =
            editor === 'monaco' ? page.locator('.monaco-editor textarea').first() : page.locator('.cm-content');
        await input.focus();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.insertText('SELECT c.');
        await page.keyboard.press('Control+Space');
        await expect(
            page.locator(editor === 'monaco' ? '.monaco-editor .suggest-widget.visible' : '.cm-tooltip-autocomplete'),
        ).toContainText('customField');
        await page.keyboard.press('Escape');

        // A failed explicit schema application must remain failed on selection.
        await page.getByRole('button', { name: 'Apply schema', exact: true }).click();
        await expect(documentsPanel.getByRole('alert')).toContainText('Cannot apply schema:');
        await sample.selectOption('nested');
        await expect(documents).toHaveValue('{');
        await expect(documentsPanel.getByRole('alert')).toContainText('Cannot apply schema:');
        await expect(inferredSchema).toContainText('No schema applied.');
    });
}

test('published editor integrations share query and schema state', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./playground');
    await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 });
    const monacoInput = page.locator('.monaco-editor textarea').first();
    await monacoInput.focus();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT c.');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.monaco-editor .suggest-widget.visible')).toContainText('address');
    await page.keyboard.press('Escape');

    await page.getByLabel('Editor', { exact: true }).selectOption('codemirror');
    const codeMirror = page.locator('.cm-content');
    await expect(codeMirror).toHaveText('SELECT c.');
    await codeMirror.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('address');
    await page.keyboard.press('Escape');

    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT CO');
    await page.keyboard.press('Control+Space');
    await page.locator('.cm-tooltip-autocomplete').getByRole('option', { name: 'COUNTAggregate', exact: true }).click();
    await expect(codeMirror).toHaveText('SELECT COUNT()');
    await page.keyboard.insertText('1');
    await expect(codeMirror).toHaveText('SELECT COUNT(1)');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT c.');

    const documents = page.getByLabel('Documents to analyze (a non-empty JSON array of objects)');
    await documents.fill('[{"newField": 42}]');
    await page.getByRole('button', { name: 'Apply schema', exact: true }).click();
    await codeMirror.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('newField');
    await page.keyboard.press('Escape');

    await documents.fill('{');
    await page.getByRole('button', { name: 'Apply schema', exact: true }).click();
    await expect(page.getByRole('region', { name: 'JSON documents', exact: true }).getByRole('alert')).toContainText(
        'Cannot apply schema:',
    );
    await expect(documents).toHaveValue('{');

    await documents.fill('[{"__proto__":{"poison":true}}]');
    await page.getByRole('button', { name: 'Apply schema', exact: true }).click();
    await expect(page.getByRole('region', { name: 'JSON documents', exact: true }).getByRole('alert')).toContainText(
        'not supported by schema analyzer',
    );

    await documents.fill('[{"restored": true}]');
    await page.getByRole('button', { name: 'Apply schema', exact: true }).click();
    await page.getByLabel('Editor', { exact: true }).selectOption('monaco');
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    await monacoInput.focus();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Control+Space');
    await expect(page.locator('.monaco-editor .suggest-widget.visible')).toContainText('restored');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT * FORM c');
    await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible();
    expect(errors).toEqual([]);
});
