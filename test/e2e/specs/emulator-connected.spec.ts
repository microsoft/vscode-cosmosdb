/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Frame } from '@playwright/test';
import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs } from '../fixtures/webviewHelpers';
import { attachEmulator, openQueryEditor } from '../fixtures/webviews';

/**
 * End-to-end coverage that requires a live Cosmos DB emulator (started and
 * seeded by `setup/globalSetup.ts`). When the suite runs with
 * `COSMOSDB_E2E_SKIP_EMULATOR=1`, the whole describe block is skipped —
 * the tests would just hang on tRPC calls that never resolve without a backend.
 *
 * What we exercise here that the smoke suite cannot:
 *  - `cosmosDB.e2e.attachEmulator` writes a real entry into the workspace
 *    attached-accounts storage (globalState + secretStorage).
 *  - The Query Editor opens with a populated `NoSqlQueryConnection` and the
 *    tRPC backend can reach the emulator on `https://localhost:8082`.
 *  - Running the default `SELECT * FROM c` returns rows from the seeded
 *    `products` container — the only definitive proof that the whole
 *    pipeline (workspace storage → connection → CosmosClient → emulator →
 *    results grid) actually works end-to-end.
 *
 * Why we don't assert on databaseId / containerId in DOM:
 *  - Those labels are rendered via `aria-label` / `title` on the connection
 *    picker, not as plain `innerText`. Polling `body.innerText` (as an
 *    earlier draft did) would never find them.
 *  - The result row's `id` field is the most stable signal: it's pure
 *    React text content and comes from a deterministic seed (`prod-00000`
 *    is always the first product — see scripts/generate-nosql-seed.mjs).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

test.describe('emulator-connected', () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — emulator tests need a live backend');

    test.afterEach(async ({ vscodeWindow }) => {
        await closeAllEditorTabs(vscodeWindow);
    });

    test('attachEmulator + run SELECT returns seeded rows', async ({ vscodeWindow }) => {
        // 1. Push the e2e emulator into the workspace attached-accounts store.
        //    Idempotent — safe to re-run across tests / retries.
        await attachEmulator(vscodeWindow);

        // 2. Open Query Editor against the seeded connection.
        const webview = await openQueryEditor(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();

        // 3. Click Run on the default query (`SELECT * FROM c`). The Run
        //    button is a Fluent UI <button> with the visible label "Run".
        //    Wait up to 30 s for the click to register — first render of
        //    the connection-aware shell can be slow on a cold worker.
        await webview.getByRole('button', { name: 'Run', exact: true }).click({ timeout: 30_000 });

        // 4. Wait for the seeded row to appear in the results table. The
        //    seed (`scripts/generate-nosql-seed.mjs`) is deterministic
        //    (PRNG seed 42) so prod-00000 is always the first product.
        //    `prod-00000` is unique enough that finding it anywhere in the
        //    frame body is sufficient proof.
        await waitForFrameText(webview, 'prod-00000');
    });
});

/**
 * Polls the frame's `body.innerText` for a substring until the deadline.
 * Used for the results-grid assertion because cell text in the Fluent UI
 * data-grid renders inside virtualized containers — `expect(...).toContainText()`
 * sometimes races the virtualization. `innerText` is the most permissive
 * match and gives us a single stable retry loop.
 */
async function waitForFrameText(frame: Frame, needle: string, timeoutMs: number = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastSnapshot = '';
    // Polling loop — awaits are sequential by design; we can't parallelize a "wait until ready" probe.
    while (Date.now() < deadline) {
        try {
            lastSnapshot = await frame.locator('body').innerText({ timeout: 1_000 });
            if (lastSnapshot.includes(needle)) return;
        } catch {
            // Frame may navigate during webview load — retry.
        }
        // oxlint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 250));
    }

    throw new Error(
        `Frame body did not contain "${needle}" within ${timeoutMs} ms. ` +
            `Last snapshot (first 600 chars): ${lastSnapshot.slice(0, 600)}`,
    );
}
