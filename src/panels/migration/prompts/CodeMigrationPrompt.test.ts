/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('../helpers/aiHelpers', () => ({ isDebugPromptsEnabled: () => false }));
vi.mock('vscode', () => ({
    workspace: {
        get workspaceFolders() {
            return [{ uri: { fsPath: '/workspace/shop' }, name: 'shop', index: 0 }];
        },
    },
}));

import { buildCodeMigrationPrompt } from './CodeMigrationPrompt';

describe('buildCodeMigrationPrompt', () => {
    afterEach(() => vi.restoreAllMocks());

    it.each(['plan', 'migrate'] as const)(
        'scopes %s to the selected project without a redundant single-root path',
        (action) => {
            const singleRoot = buildCodeMigrationPrompt(undefined, '.cosmosdb-migration', action, '/workspace/shop');
            expect(singleRoot).not.toContain('Workspace:');
            expect(singleRoot).toContain('Scan only the selected application project');
            expect(singleRoot).not.toContain('Scan the entire workspace');

            vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([]);
            const scoped = buildCodeMigrationPrompt(undefined, '.cosmosdb-migration', action, '/workspace/shop');
            expect(scoped).toContain(`Workspace: ${JSON.stringify(path.resolve('/workspace/shop'))}`);
            expect(scoped).toContain('Do not scan other workspace folders');
        },
    );

    it.each(['plan', 'migrate'] as const)('preserves Chat questions and scope approval in %s mode', (action) => {
        const prompt = buildCodeMigrationPrompt(undefined, '.cosmosdb-migration', action, '/workspace/shop');
        expect(prompt).toContain('ask before expanding scope to external application dependencies');
        expect(prompt).toContain('always ask clarifying questions');
        expect(prompt).toContain('ask the user now');
        expect(prompt).not.toMatch(/non-interactive|Do not ask questions|without requesting confirmation/u);
    });

    it('requires the deterministic plan manifest in plan mode', () => {
        const prompt = buildCodeMigrationPrompt(undefined, '.cosmosdb-migration', 'plan');
        expect(prompt).toContain('code-migration-manifest.json');
        expect(prompt).toContain('Artifact regeneration: required');
        expect(prompt).toContain('do not ask whether to validate instead');
        expect(prompt).toContain('mode "plan"');
        expect(prompt).toContain('outputFiles: empty in plan mode');
        expect(prompt).toContain('modelSha256:');
        expect(prompt).toContain('sdkReportSha256:');
        expect(prompt).toContain('unique model-selected rule paths');
        expect(prompt).toContain('Blocker Review');
        expect(prompt).toContain('Review execution blockers during planning');
        expect(prompt).toContain('ask the user now');
        expect(prompt).toContain('recommendation rationale that cites evidence and constraints');
        expect(prompt).toContain('A "Recommended" label alone is not a rationale');
        expect(prompt).toContain('Defer only blockers that cannot be resolved during planning');
        expect(prompt).toContain('phases.codeMigration');
    });

    it('requires hashes, substantive check coverage, and SDK permission in migrate mode', () => {
        const prompt = buildCodeMigrationPrompt(undefined, '.cosmosdb-migration', 'migrate');
        expect(prompt).toContain('mode "migrate"');
        expect(prompt).toContain('lowercase SHA-256 hash');
        expect(prompt).not.toContain('at least one successful command');
        expect(prompt).toContain('both build and behavior');
        expect(prompt).toContain('focused behavioral tests');
        expect(prompt).toContain('coverage, meaningful limitations');
        expect(prompt).toContain('not command names, execution, or test quality');
        expect(prompt).toContain('do not fabricate evidence');
        expect(prompt).toContain('discovery-manifest.json');
        expect(prompt).toContain('unresolvedConcerns');
        expect(prompt).toContain('after resolving symlinks');
    });

    it.each(['plan', 'migrate'] as const)('specifies the exact SDK report hash serialization in %s mode', (action) => {
        const prompt = buildCodeMigrationPrompt(undefined, '.cosmosdb-migration', action);
        expect(prompt).toContain(
            'modelSha256: the lowercase SHA-256 hash of the exact canonical model.json file bytes',
        );
        expect(prompt).toContain(
            'sdkReportSha256: read `.cosmosdb-migration/phases/1-discovery/discovery-manifest.json`',
        );
        expect(prompt).toContain('extract its sdkCompatibility object');
        expect(prompt).toContain("UTF-8 bytes of `JSON.stringify(sdkCompatibility, null, 2) + '\\n'`");
        expect(prompt).toContain('object-property order and including the single trailing newline');
        expect(prompt).toContain('not the whole discovery manifest or a preflight artifact');
        expect(prompt).not.toContain('modelSha256 and sdkReportSha256 computed from the exact bytes');
    });

    it('defaults to planning', () => {
        const prompt = buildCodeMigrationPrompt(undefined, '.cosmosdb-migration');
        expect(prompt).toContain('mode "plan"');
        expect(prompt).toContain('Do NOT begin implementing any code changes');
    });
});
