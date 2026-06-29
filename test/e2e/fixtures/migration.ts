/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Page-object helpers for driving the Migration Assistant webview from e2e
 * specs. Selectors prefer the stable `data-testid` attributes added to the
 * React component (see `src/webviews/cosmosdb/Migration/MigrationAssistant.tsx`)
 * and fall back to visible phase-header text for the collapsible accordion.
 */

import { CosmosClient } from '@azure/cosmos';
import { expect, type Frame, type Locator } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { E2E_EMULATOR_ENDPOINT, E2E_EMULATOR_KEY } from '../setup/emulator';

/** Tunes the migration AI mock (delay/failure) for the current test. */
export function setMockControl(control: { delayMs?: number; failRoutes?: string[] }): void {
    const dir = process.env.COSMOSDB_E2E_MIGRATION_CAPTURE_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'control.json'), JSON.stringify(control));
}

/** Clears any mock control so the next test runs at full speed. */
export function clearMockControl(): void {
    const dir = process.env.COSMOSDB_E2E_MIGRATION_CAPTURE_DIR;
    if (!dir) return;
    try {
        rmSync(path.join(dir, 'control.json'), { force: true });
    } catch {
        /* ignore */
    }
}

/** Reads the workspace `.gitignore` (empty string when absent). */
export function readGitignore(): string {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!ws) return '';
    try {
        return readFileSync(path.join(ws, '.gitignore'), 'utf-8');
    } catch {
        return '';
    }
}

/** True when the worker workspace currently has a seeded `.git` directory. */
export function gitDirExists(): boolean {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    return !!ws && existsSync(path.join(ws, '.git'));
}

/** Absolute path to a Phase 4 provisioning artifact in the worker workspace. */
function provisioningArtifact(name: 'sample-data.json' | 'seed-data.csh'): string | undefined {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!ws) return undefined;
    return path.join(ws, '.cosmosdb-migration', 'phases', '4-provisioning', name);
}

/** True when a given Phase 4 provisioning artifact exists on disk. */
export function provisioningArtifactExists(name: 'sample-data.json' | 'seed-data.csh'): boolean {
    const p = provisioningArtifact(name);
    return !!p && existsSync(p);
}

/**
 * Reads a migration artifact relative to the worker workspace's
 * `.cosmosdb-migration` root (e.g. `phases/1-discovery/discovery-report.md`).
 * Returns `undefined` when the env or file is absent.
 */
export function readMigrationArtifact(relativePath: string): string | undefined {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!ws) return undefined;
    try {
        return readFileSync(path.join(ws, '.cosmosdb-migration', relativePath), 'utf-8');
    } catch {
        return undefined;
    }
}

/** Reads + JSON-parses a migration artifact (undefined when absent/invalid). */
export function readMigrationJson<T = unknown>(relativePath: string): T | undefined {
    const raw = readMigrationArtifact(relativePath);
    if (raw === undefined) return undefined;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

/**
 * Simulates Copilot Chat producing the code migration plan by writing
 * `code-migration-plan.md` into the worker workspace's `.cosmosdb-migration`
 * root. The extension's file watcher picks it up and flips `hasCodeMigrationPlan`.
 */
export function writeCodeMigrationPlan(content = '# Code Migration Plan\n'): void {
    const ws = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
    if (!ws) throw new Error('COSMOSDB_E2E_WORKSPACE_DIR is not set');
    const dir = path.join(ws, '.cosmosdb-migration');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'code-migration-plan.md'), content, 'utf-8');
}

/** Reads + parses the generated `sample-data.json` (undefined when absent). */
export function readSampleData(): { sampleData: { containerName: string; items: unknown[] }[] } | undefined {
    const p = provisioningArtifact('sample-data.json');
    if (!p || !existsSync(p)) return undefined;
    try {
        return JSON.parse(readFileSync(p, 'utf-8')) as { sampleData: { containerName: string; items: unknown[] }[] };
    } catch {
        return undefined;
    }
}

/** Reads every document from an emulator container (id-sorted, no system fields). */
export async function readEmulatorItems(databaseId: string, containerId: string): Promise<Record<string, unknown>[]> {
    // Scoped self-signed-cert trust, mirroring `test/e2e/setup/emulator.ts`. The
    // agent is local to this client so the relaxation never leaks process-wide.
    const client = new CosmosClient({
        endpoint: E2E_EMULATOR_ENDPOINT,
        key: E2E_EMULATOR_KEY,
        connectionPolicy: { enableEndpointDiscovery: false },
        agent: new https.Agent({ rejectUnauthorized: false }),
    });
    const container = client.database(databaseId).container(containerId);
    const { resources } = await container.items.readAll<Record<string, unknown>>().fetchAll();
    return resources
        .map((doc) => {
            const stripped: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(doc)) {
                if (!k.startsWith('_')) stripped[k] = v;
            }
            return stripped;
        })
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/** Reads the migration AI-mock prompt capture log written during the run. */
export function readCapturedPrompts(): { route: string | null; promptText: string }[] {
    const dir = process.env.COSMOSDB_E2E_MIGRATION_CAPTURE_DIR;
    if (!dir) return [];
    try {
        return readFileSync(path.join(dir, 'capture.jsonl'), 'utf-8')
            .split('\n')
            .filter((l) => l.trim().length > 0)
            .map((l) => JSON.parse(l) as { route: string | null; promptText: string });
    } catch {
        return [];
    }
}

/** Visible (English-default) phase header labels. */
export const PHASE_HEADERS = {
    phase1: 'Phase 1: Discovery Report',
    phase2: 'Phase 2: Domain Assessment',
    phase3: 'Phase 3: Schema Conversion',
    phase4: 'Phase 4: Target Cosmos DB Environment',
} as const;

export class MigrationPage {
    constructor(private readonly frame: Frame) {}

    get root(): Locator {
        return this.frame.locator('#root');
    }

    get consentCheckbox(): Locator {
        // Fluent UI's Checkbox renders the real <input type="checkbox"> with the
        // accessible name taken from its label. Target it by role rather than by
        // data-testid (which Fluent places on the root wrapper, not the input).
        return this.frame.getByRole('checkbox', { name: /acknowledge that this feature uses AI/i });
    }

    get modelDropdown(): Locator {
        return this.frame.getByTestId('migration-model-dropdown');
    }

    runDiscoveryButton(): Locator {
        return this.frame.getByTestId('migration-run-discovery');
    }

    runAssessmentButton(): Locator {
        return this.frame.getByTestId('migration-run-assessment');
    }

    runConversionButton(): Locator {
        return this.frame.getByTestId('migration-run-conversion');
    }

    // ── Configuration / Phase 1 controls ─────────────────────────────
    get autoDetectButton(): Locator {
        return this.frame.getByTestId('migration-auto-detect');
    }

    get projectNameInput(): Locator {
        return this.frame.getByTestId('migration-project-name');
    }

    /** An Application Details input by field key. */
    analysisField(field: 'project-name' | 'project-type' | 'language' | 'frameworks' | 'database' | 'access'): Locator {
        return this.frame.getByTestId(`migration-${field}`);
    }

    get viewDiscoveryButton(): Locator {
        return this.frame.getByTestId('migration-view-discovery');
    }

    get gitignoreExclude(): Locator {
        return this.frame.getByRole('checkbox', { name: /Exclude migration configuration from version control/i });
    }

    get gitInitButton(): Locator {
        return this.frame.getByTestId('migration-git-init');
    }

    get aiDisabledWarning(): Locator {
        return this.frame.getByTestId('migration-ai-disabled-warning');
    }

    instructions(phase: 'discovery' | 'assessment' | 'conversion'): Locator {
        return this.frame.getByTestId(`migration-${phase}-instructions`);
    }

    // ── Progress / cancel / error states ─────────────────────────────
    get progressBar(): Locator {
        return this.frame.getByRole('progressbar');
    }

    get cancelButton(): Locator {
        return this.frame.getByRole('button', { name: 'Cancel', exact: true });
    }

    get errorAlert(): Locator {
        return this.frame.getByRole('alert');
    }

    phaseHeader(label: string): Locator {
        return this.frame.getByText(label, { exact: true });
    }

    phaseCompleteBadge(phase: 'phase1' | 'phase2' | 'phase3' | 'phase4'): Locator {
        return this.frame.getByTestId(`migration-${phase}-status-complete`);
    }

    // ── Phase 2 artifacts ────────────────────────────────────────────
    get phase2DomainTable(): Locator {
        return this.frame.getByTestId('migration-phase2-domains');
    }

    /** Per-domain summary links rendered in the Phase 2 table. */
    phase2DomainLinks(): Locator {
        return this.frame.getByTestId('migration-phase2-domain-link');
    }

    get phase2SummaryButton(): Locator {
        return this.frame.getByTestId('migration-phase2-summary');
    }

    // ── Phase 3 artifacts ────────────────────────────────────────────
    get phase3DomainTable(): Locator {
        return this.frame.getByTestId('migration-phase3-domains');
    }

    /** Per-domain summary links rendered in the Phase 3 table. */
    phase3DomainLinks(): Locator {
        return this.frame.getByTestId('migration-phase3-domain-link');
    }

    /** Per-domain JSON model links rendered in the Phase 3 table. */
    phase3ModelLinks(): Locator {
        return this.frame.getByTestId('migration-phase3-model-link');
    }

    get phase3SummaryButton(): Locator {
        return this.frame.getByTestId('migration-phase3-summary');
    }

    get phase3ModelButton(): Locator {
        return this.frame.getByTestId('migration-phase3-model');
    }

    // ── Phase 4: Target environment / provisioning ───────────────────
    get emulatorRadio(): Locator {
        return this.frame.getByRole('radio', { name: /Local Cosmos DB Emulator/i });
    }

    get testConnectionButton(): Locator {
        return this.frame.getByTestId('migration-test-connection');
    }

    get connectionVerified(): Locator {
        return this.frame.getByTestId('migration-connection-verified');
    }

    get populateSampleDataButton(): Locator {
        return this.frame.getByTestId('migration-populate-sample-data');
    }

    get provisioningSummary(): Locator {
        return this.frame.getByTestId('migration-provisioning-summary');
    }

    // ── Final step: Plan / Start Migration ───────────────────────────
    /** Primary action of the footer SplitButton ("Plan Migration" / "Start Migration"). */
    get migrationActionButton(): Locator {
        return this.frame.getByTestId('migration-action-button');
    }

    /** "View Plan" link, rendered only once a code migration plan exists. */
    get viewPlanLink(): Locator {
        return this.frame.getByTestId('migration-view-plan');
    }

    /**
     * A VS Code editor/preview tab by accessible name. Tabs live in the
     * workbench (outside the webview iframe), reachable via `frame.page()`.
     */
    openedTab(name: string | RegExp): Locator {
        return this.frame.page().getByRole('tab', { name });
    }

    /**
     * Re-activates the Migration Assistant editor tab. Opening an artifact tab
     * makes the webview the inactive tab, so the panel must be refocused before
     * interacting with its controls again.
     */
    async focus(): Promise<void> {
        await this.openedTab(/Cosmos DB Migration Assistant/).click();
        await expect(this.modelDropdown).toBeVisible();
    }

    /**
     * Expands a collapsed accordion phase by clicking its header. The Phase 1
     * panel is open by default; Phases 2–4 must be expanded before their
     * controls become interactable.
     */
    async expandPhase(label: string): Promise<void> {
        await this.phaseHeader(label).click();
    }

    /** Runs a phase end-to-end and waits for its completion badge. */
    async runDiscovery(timeoutMs = 60_000): Promise<void> {
        await expect(this.runDiscoveryButton()).toBeEnabled();
        await this.runDiscoveryButton().click();
        await expect(this.phaseCompleteBadge('phase1')).toBeVisible({ timeout: timeoutMs });
    }

    async runAssessment(timeoutMs = 60_000): Promise<void> {
        await this.expandPhase(PHASE_HEADERS.phase2);
        await expect(this.runAssessmentButton()).toBeEnabled();
        await this.runAssessmentButton().click();
        await expect(this.phaseCompleteBadge('phase2')).toBeVisible({ timeout: timeoutMs });
    }

    async runConversion(timeoutMs = 90_000): Promise<void> {
        await this.expandPhase(PHASE_HEADERS.phase3);
        await expect(this.runConversionButton()).toBeEnabled();
        await this.runConversionButton().click();
        await expect(this.phaseCompleteBadge('phase3')).toBeVisible({ timeout: timeoutMs });
    }
}
