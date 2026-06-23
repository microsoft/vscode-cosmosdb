/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Page-object for the Cosmos DB **Document** webview (`src/webviews/cosmosdb/Document`).
 *
 * The Query Editor opens this panel for every row-level action — "Add new item"
 * (add mode), double-click / "View selected item" (read-only view mode), and
 * "Edit selected item" (edit mode). It hosts a Monaco JSON editor plus a small
 * toolbar (Save / Edit / Refresh) and a set of status banners
 * ("This item is read-only." / "…editable." / "…unsaved changes." / validation).
 *
 * The CRUD spec (`queryEditor-crud.spec.ts`) drives it to create, inspect and
 * delete a throwaway document, so this object exposes just enough surface for
 * that flow: read the mode banner, replace the JSON, and Save.
 */

import { type ElectronApplication, expect, type Frame, type Page } from '@playwright/test';
import { type ConsoleHealth, startConsoleHealth } from './consoleHealth';

const DEFAULT_TIMEOUT_MS = 15_000;

export class DocumentPanel {
    private constructor(
        /** The Document webview content frame. */
        public readonly frame: Frame,
        /** The VS Code main window page. */
        public readonly window: Page,
        /** The Electron application (used to drive the OS clipboard for paste). */
        public readonly app: ElectronApplication,
        /** Console-health monitor attached at mount time. */
        public readonly consoleHealth: ConsoleHealth,
    ) {}

    /**
     * Wraps an already-mounted Document frame (typically the value returned by
     * `QueryEditorPage.waitForDocumentPanel()`), attaching a console-health
     * monitor and waiting until the editor has painted.
     */
    static async attach(frame: Frame, window: Page, app: ElectronApplication): Promise<DocumentPanel> {
        const consoleHealth = startConsoleHealth(frame);
        await expect(frame.locator('#root')).toBeVisible();
        await frame.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
        return new DocumentPanel(frame, window, app, consoleHealth);
    }

    /** True once the read-only banner is shown (view mode). */
    async isReadOnly(): Promise<boolean> {
        return (await this.frame.getByText('This item is read-only.', { exact: false }).count()) > 0;
    }

    /** Asserts the panel is in read-only (view) mode. */
    async expectReadOnly(): Promise<void> {
        await expect(this.frame.getByText('This item is read-only.', { exact: false })).toBeVisible({
            timeout: DEFAULT_TIMEOUT_MS,
        });
    }

    /** Asserts the panel is editable (add / edit mode). */
    async expectEditable(): Promise<void> {
        await expect(this.frame.getByText('This item is editable.', { exact: false })).toBeVisible({
            timeout: DEFAULT_TIMEOUT_MS,
        });
    }

    private saveButton() {
        return this.frame.getByRole('button', { name: 'Save item to the database' });
    }

    /**
     * Replaces the Monaco editor content with `json`.
     *
     * Uses `keyboard.insertText` rather than `keyboard.type`: Monaco auto-closes
     * brackets and quotes on individual keystrokes, which would corrupt typed
     * JSON. `insertText` dispatches a single input event (paste-like), so the
     * text lands verbatim.
     */
    async setContent(json: string): Promise<void> {
        // Paste via the OS clipboard rather than typing. Monaco's auto-closing
        // brackets/quotes and auto-indent corrupt both typed and `insertText`ed
        // JSON (stray `}` and cascading indentation); a paste is inserted
        // verbatim. Electron's `clipboard` module sets the OS clipboard directly.
        await this.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), json);
        await this.frame.locator('.monaco-editor').first().click();
        await this.frame.locator('textarea.inputarea').first().waitFor({ state: 'attached', timeout: 5_000 });
        await this.window.keyboard.press('Control+A');
        await this.window.keyboard.press('Control+V');
    }

    /**
     * Clicks Save and waits for the save to settle — the button re-disables once
     * the document is no longer dirty (`isSaveDisabled` when `!isDirty`), which
     * is the cleanest in-DOM signal that the round-trip to the emulator
     * completed.
     */
    async save(): Promise<void> {
        await expect(this.saveButton()).toBeEnabled({ timeout: DEFAULT_TIMEOUT_MS });
        await this.saveButton().click();
        await expect(this.saveButton()).toBeDisabled({ timeout: DEFAULT_TIMEOUT_MS });
    }

    dispose(): void {
        this.consoleHealth.dispose();
    }
}
