/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pre-test activation handshake for a freshly launched VS Code instance.
 *
 * Why we need this
 * ----------------
 * Both `ms-azuretools.vscode-azureresourcegroups` (the host) and
 * `ms-azuretools.vscode-cosmosdb` (the extension under test) use **lazy
 * activation**:
 *   - Azure Resources activates when its view container is revealed.
 *   - Our extension activates on `onView:azureWorkspace` /
 *     `onView:azureResourceGroups` (among others) — i.e. only after Azure
 *     Resources has rendered its tree.
 *
 * If a test calls `cosmosDB.e2e.attachEmulator` before this chain has
 * fired, the command won't exist yet (it's registered inside
 * `activate()` → `registerE2eTestCommands`) and the run goes red with a
 * confusing "command not found" or silently no-ops.
 *
 * What this helper does
 * ---------------------
 * 1. Waits for the Azure activity-bar tab to be registered, then clicks it to
 *    open the sidebar. This wakes Azure Resources, which in turn pulls our
 *    extension up via the activation events above.
 * 2. Polls the workbench DOM until the `Cosmos DB Accounts` row appears
 *    in the Workspaces tree. That label is produced by
 *    `CosmosDBWorkspaceItem.ts` and is only contributed by our extension —
 *    its presence is the definitive proof that both extensions activated
 *    successfully and registered their workspace branch providers.
 *
 * Worker scope
 * ------------
 * Invoked once per worker (from the `vscodeWindow` fixture), then cached.
 * VS Code is reused across every test in that worker so we only pay the
 * ~2-5 s activation cost once.
 */

import { type Page } from '@playwright/test';

const ACTIVATION_TIMEOUT_MS = 60_000;
const ACTIVATION_POLL_INTERVAL_MS = 500;

/**
 * Label rendered by `CosmosDBWorkspaceItem.getTreeItem()`. The exact string
 * must stay in sync with `src/tree/workspace-view/cosmosdb/CosmosDBWorkspaceItem.ts`.
 * If that label ever gets l10n'd to a non-English locale at test time, this
 * helper will need to read it from the same translation source.
 */
const WORKSPACE_TREE_NODE_LABEL = 'Cosmos DB Accounts';

export async function waitForExtensionsActivated(window: Page): Promise<void> {
    const deadline = Date.now() + ACTIVATION_TIMEOUT_MS;
    // The workbench can be visible before extension views are registered. Opening the command palette then
    // snapshots an incomplete command list, and "View: Show Azure" resolves to an unrelated "similar command".
    // The activity-bar locator waits for the actual contribution instead of executing that fallback.
    await window.getByRole('tab', { name: /^Azure(?: \(|$)/ }).click({ timeout: ACTIVATION_TIMEOUT_MS });

    // 2. Wait for our workspace contribution to render. Polling DOM is the
    //    most resilient signal we have without a direct bridge into the
    //    VS Code extension host.
    const nodeLocator = window.getByRole('treeitem', { name: WORKSPACE_TREE_NODE_LABEL });

    let lastError: string = '(no probes yet)';

    while (Date.now() < deadline) {
        try {
            // oxlint-disable-next-line no-await-in-loop
            const count = await nodeLocator.count();
            if (count > 0) {
                return;
            }
            lastError = `tree item "${WORKSPACE_TREE_NODE_LABEL}" not present (count=${count})`;
        } catch (err) {
            lastError = (err as Error).message;
        }
        await window.waitForTimeout(ACTIVATION_POLL_INTERVAL_MS);
    }

    throw new Error(
        `Extensions did not finish activating within ${ACTIVATION_TIMEOUT_MS} ms. ` +
            `Expected the "${WORKSPACE_TREE_NODE_LABEL}" tree item to appear after revealing the Azure sidebar. ` +
            `Last probe: ${lastError}. ` +
            `Common causes: ` +
            `(a) the dependent extension "ms-azuretools.vscode-azureresourcegroups" failed to install ` +
            `(check .vscode-test/e2e-extensions/.installed); ` +
            `(b) the extension under test crashed during activate() — check the test output for stack traces.`,
    );
}
