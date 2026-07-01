/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Frame } from '@playwright/test';
import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs } from '../fixtures/webviewHelpers';
import {
    clearMockGenerateQueryResult,
    clearMockLanguageModels,
    openQueryEditor,
    setAIFeaturesEnabled,
    setMockGenerateQueryConfirm,
    setMockGenerateQueryError,
    setMockGenerateQuerySuccess,
    setMockLanguageModels,
} from '../fixtures/webviews';

/**
 * Coverage for the Generate Query input
 * (`src/webviews/cosmosdb/QueryEditor/QueryPanel/GenerateQueryInput.tsx`),
 * the natural-language prompt box revealed by the toolbar AI button's
 * "Generate query" action.
 *
 * This spec only covers behavior that requires a real VS Code host and cannot
 * be exercised by the `GenerateQueryInput.test.tsx` unit tests (which mock the
 * tRPC client). Pure UI state — typing, submit enable/disable, feedback button
 * locking, and closing the input — is covered there, so it is not repeated here.
 *
 * What we assert:
 *   1. Model switcher — with two fake Copilot models injected, the model
 *      `Combobox` lists both and updates the displayed selection when changed.
 *   2. Schema tool    — the Allow/Deny confirmation dialog rendered mid-
 *      generation, and that Allow inserts the query while Deny cancels.
 *   3. Generation     — a successful generation inserts the query text into the
 *      editor, and a failed generation surfaces an error MessageBar. Both drive
 *      the real `generateQueryWithLLM` service via a route-aware mock language
 *      model (see `setE2eGenerateQueryRoute` in
 *      `src/commands/e2eTestCommands/generateQueryMockModel.ts`): the `success`
 *      route streams back a query, the `error` route streams back an
 *      `ERROR:`-prefixed refusal.
 *
 * Mocking the Copilot call
 * ------------------------
 * The model switcher only renders when more than one language model is
 * available, and the list comes from `vscode.lm.selectChatModels` (the remote
 * Copilot call). A fresh test VS Code has no Copilot, so the
 * `cosmosDB.e2e.setMockLanguageModels` command installs a deterministic pair
 * of fake models that bypass that API.
 *
 * No emulator needed — the Query Editor mounts and the input renders from local
 * state, so this spec runs in both `npm run e2e` and skip-emulator modes.
 */

/** Accessible name of the prompt textarea (its `aria-label`). */
const PROMPT_LABEL = 'Describe your query in natural language';

/** Fake model names injected by `setMockLanguageModels` — kept in lockstep with
 * the `E2E_MOCK_MODELS` fixtures in `registerE2eTestCommands.ts`. */
const MOCK_MODELS = ['Mock GPT-4o', 'Mock GPT-4o mini'] as const;

/**
 * Opens the toolbar AI menu and clicks "Generate query" to reveal the input.
 *
 * The AI button only renders when AI features are enabled, so callers must run
 * `setAIFeaturesEnabled` before opening the editor. The toolbar renders
 * asynchronously once the initial tRPC state arrives, so we wait for it and
 * poll for the button before clicking.
 */
async function showGenerateQueryInput(webview: Frame): Promise<undefined> {
    const toolbar = webview.getByRole('toolbar').first();
    await toolbar.waitFor({ state: 'visible', timeout: 30_000 });

    const aiButton = toolbar.getByRole('button', { name: 'AI', exact: true }).first();
    await expect.poll(() => aiButton.isVisible().catch(() => false), { timeout: 30_000 }).toBe(true);
    await aiButton.click();

    await webview.getByRole('menuitem', { name: 'Generate query', exact: true }).click();
}

/**
 * Scopes locators to the Generate Query input's inner container — the closest
 * `<div>` ancestor shared by the prompt textarea and the footer (model
 * switcher + submit). This keeps the model `Combobox` lookup from colliding
 * with the Result Panel's page-size dropdown, which also exposes
 * `role="combobox"`.
 */
function generatePanel(webview: Frame) {
    return webview.locator(`div:has(textarea[aria-label="${PROMPT_LABEL}"])`).last();
}

/**
 * Full setup: enable AI, inject mock models, open the editor, and reveal the
 * Generate Query input. Returns the webview frame with the prompt visible.
 */
async function openGenerateInput(page: Parameters<typeof openQueryEditor>[0]): Promise<Frame> {
    await setAIFeaturesEnabled(page);
    await setMockLanguageModels(page);

    const webview = await openQueryEditor(page);
    await showGenerateQueryInput(webview);

    await expect(webview.getByRole('textbox', { name: PROMPT_LABEL })).toBeVisible();
    return webview;
}

test.describe('generate query input', () => {
    test.afterEach(async ({ vscodeWindow }) => {
        // A test may end (pass or fail) with the input or a menu/combobox still
        // open. Press Escape to dismiss it before closing tabs.
        await vscodeWindow.keyboard.press('Escape');
        await vscodeWindow.waitForTimeout(150);
        // Clear the fake-model override so it can't leak into other specs that
        // share the worker VS Code instance (each test re-installs it on setup).
        await clearMockLanguageModels(vscodeWindow);
        await closeAllEditorTabs(vscodeWindow);
    });

    test('model switcher lists the mocked models and updates the selection', async ({ vscodeWindow }) => {
        const webview = await openGenerateInput(vscodeWindow);

        const combobox = generatePanel(webview).getByRole('combobox');
        await expect(combobox).toBeVisible();
        // Defaults to the first available model.
        await expect(combobox).toHaveValue(MOCK_MODELS[0]);

        await combobox.click();
        for (const name of MOCK_MODELS) {
            await expect(webview.getByRole('option', { name, exact: true })).toBeVisible();
        }

        await webview.getByRole('option', { name: MOCK_MODELS[1], exact: true }).click();
        await expect(combobox).toHaveValue(MOCK_MODELS[1]);
    });

    test('schema tool confirmation dialog appears and Allow inserts the query', async ({ vscodeWindow }) => {
        // Simulates the LLM deciding to run the schema-sampling tool mid-generation:
        // the Allow/Deny dialog renders inside the Generate Query input.
        await setMockGenerateQueryConfirm(vscodeWindow);

        const webview = await openGenerateInput(vscodeWindow);

        const textarea = webview.getByRole('textbox', { name: PROMPT_LABEL });
        await textarea.fill('show me all products under $20');

        const submit = webview.getByRole('button', { name: 'Generate query', exact: true });
        await submit.click();

        // The schema-access confirmation dialog should appear with Allow/Deny.
        const confirmDialog = webview.locator('[role="alertdialog"]');
        await expect(confirmDialog).toBeVisible({ timeout: 15_000 });
        await expect(confirmDialog).toContainText('sample your container schema');
        const allowButton = confirmDialog.getByRole('button', { name: 'Allow', exact: true });
        const denyButton = confirmDialog.getByRole('button', { name: 'Deny', exact: true });
        await expect(allowButton).toBeVisible();
        await expect(denyButton).toBeVisible();

        // Allowing schema access resumes generation; the query is returned and inserted.
        await allowButton.click();
        await expect(confirmDialog).toBeHidden({ timeout: 10_000 });
        await expect
            .poll(
                () =>
                    webview
                        .locator('text=SELECT * FROM c WHERE c.price < 20')
                        .first()
                        .isVisible()
                        .catch(() => false),
                { timeout: 15_000 },
            )
            .toBe(true);

        await clearMockGenerateQueryResult(vscodeWindow);
    });

    test('schema tool confirmation dialog Deny cancels generation', async ({ vscodeWindow }) => {
        await setMockGenerateQueryConfirm(vscodeWindow);

        const webview = await openGenerateInput(vscodeWindow);

        const textarea = webview.getByRole('textbox', { name: PROMPT_LABEL });
        await textarea.fill('show me all products under $20');

        const submit = webview.getByRole('button', { name: 'Generate query', exact: true });
        await submit.click();

        const confirmDialog = webview.locator('[role="alertdialog"]');
        await expect(confirmDialog).toBeVisible({ timeout: 15_000 });

        // Denying schema access ends generation without inserting a query.
        await confirmDialog.getByRole('button', { name: 'Deny', exact: true }).click();
        await expect(confirmDialog).toBeHidden({ timeout: 10_000 });
        await expect(webview.locator('text=SELECT * FROM c WHERE c.price < 20')).toHaveCount(0);

        await clearMockGenerateQueryResult(vscodeWindow);
    });

    test('successful query generation inserts text into editor', async ({ vscodeWindow }) => {
        // Routes the mock language model down its success branch; the real
        // `generateQueryWithLLM` service returns the query, which is inserted.
        await setMockGenerateQuerySuccess(vscodeWindow);

        const webview = await openGenerateInput(vscodeWindow);

        const textarea = webview.getByRole('textbox', { name: PROMPT_LABEL });
        await textarea.fill('show me cheap products');

        const submit = webview.getByRole('button', { name: 'Generate query', exact: true });
        await submit.click();

        // The generated query text should appear somewhere in the webview
        // (it gets dispatched into the Monaco editor as an insertText action).
        await expect
            .poll(
                () =>
                    webview
                        .locator('text=SELECT * FROM c WHERE c.price < 20')
                        .first()
                        .isVisible()
                        .catch(() => false),
                { timeout: 15_000 },
            )
            .toBe(true);

        await clearMockGenerateQueryResult(vscodeWindow);
    });

    test('error from query generation shows error message bar', async ({ vscodeWindow }) => {
        // Routes the mock language model down its error branch; the real
        // `generateQueryWithLLM` service parses the `ERROR:`-prefixed response
        // into a `QueryGenerationRefusedError`, surfacing the error MessageBar.
        await setMockGenerateQueryError(vscodeWindow);

        const webview = await openGenerateInput(vscodeWindow);

        const textarea = webview.getByRole('textbox', { name: PROMPT_LABEL });
        await textarea.fill('do something impossible');

        const submit = webview.getByRole('button', { name: 'Generate query', exact: true });
        await submit.click();

        // The error MessageBar should appear with the baked-in error text.
        const errorBar = webview.locator('[class*="MessageBarBody"]').filter({
            hasText: 'I cannot generate a query for that request',
        });
        await expect.poll(() => errorBar.isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);

        await clearMockGenerateQueryResult(vscodeWindow);
    });
});
