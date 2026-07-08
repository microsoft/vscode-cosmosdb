/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Frame } from '@playwright/test';
import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs, getWebviewByPredicate } from '../fixtures/webviewHelpers';
import { applyEditQuerySuggestion, openEditQuerySuggestionSideBySide, openQueryEditor } from '../fixtures/webviews';

/**
 * Coverage for the Cosmos DB chat participant's edit-query action buttons —
 * specifically that clicking them produces the right editor effect:
 *   - "✅ Update Query"        → `cosmosDB.applyQuerySuggestion` updates the
 *                                active Query Editor in place.
 *   - "🔍 Open Side-by-Side"   → `cosmosDB.openQuerySideBySide` opens the
 *                                suggested query in a new Query Editor tab.
 *
 * Why not drive the native Chat view?
 * -----------------------------------
 * The VS Code Chat view needs a registered `vscode.lm` chat-model provider
 * (Copilot) to invoke `@cosmosdb` at all, which a fresh test VS Code doesn't
 * have — and our mock only patches `getSelectedModel`, not the chat picker. So
 * the participant's request-handling (command dispatch, general question, and
 * that editQuery *renders* these buttons) is covered by the vitest suite
 * `src/chat/cosmosDbChatParticipant.test.ts`. Here we test only the buttons'
 * runtime effect, which is a plain command over the static
 * `CosmosDbChatParticipant.pendingResults` map — no chat/LLM/Copilot involved.
 *
 * The `cosmosDB.e2e.applyEditQuerySuggestion` / `…openEditQuerySuggestionSideBySide`
 * test-only commands seed a pending result from the active editor's connection,
 * then invoke the real button command.
 *
 * These need a *connected* Query Editor (the seed reads its connection and the
 * apply path matches by connection), so they require the e2e emulator.
 */

/** Distinctive query the seed commands apply — matches `E2E_EDIT_QUERY_SUGGESTION`
 * in `src/commands/e2eTestCommands/registerE2eTestCommands.ts`. */
const SUGGESTED_QUERY = 'SELECT * FROM c WHERE c.e2eEditQuery = true';

/** True when a webview frame's editor contains the suggested query text. */
const frameHasSuggestedQuery = async (frame: Frame): Promise<boolean> =>
    (await frame.locator(`text=${SUGGESTED_QUERY}`).count()) > 0;

test.describe('chat participant edit-query buttons', () => {
    test.afterEach(async ({ vscodeWindow }) => {
        await closeAllEditorTabs(vscodeWindow);
    });

    test('Update Query applies the suggestion to the active editor', async ({ vscodeWindow }) => {
        test.skip(
            process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1',
            'edit-query apply needs a connected Query Editor (emulator)',
        );

        const webview = await openQueryEditor(vscodeWindow);

        // Seeds a pending result from this editor's connection and runs the real
        // `cosmosDB.applyQuerySuggestion`, which updates this same editor.
        await applyEditQuerySuggestion(vscodeWindow);

        await expect
            .poll(
                () =>
                    webview
                        .locator(`text=${SUGGESTED_QUERY}`)
                        .first()
                        .isVisible()
                        .catch(() => false),
                {
                    timeout: 15_000,
                },
            )
            .toBe(true);
    });

    test('Open Side-by-Side opens the suggestion in a new editor', async ({ vscodeWindow }) => {
        test.skip(
            process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1',
            'edit-query side-by-side needs a connected Query Editor (emulator)',
        );

        await openQueryEditor(vscodeWindow);

        // Opens the suggested query in a new Query Editor tab (column two).
        await openEditQuerySuggestionSideBySide(vscodeWindow);

        // A (new) Query Editor webview should contain the suggested query.
        const sideBySide = await getWebviewByPredicate(vscodeWindow, frameHasSuggestedQuery);
        await expect(sideBySide.locator(`text=${SUGGESTED_QUERY}`).first()).toBeVisible();
    });
});
