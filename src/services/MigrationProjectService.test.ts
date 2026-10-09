/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { type Mock } from 'vitest';
import * as vscode from 'vscode';
import { MIGRATION_FOLDER, MigrationProjectService, normalizeMigrationProject } from './MigrationProjectService';

describe('normalizeMigrationProject', () => {
    it('preserves fields while restoring the required project structure', () => {
        expect(
            normalizeMigrationProject({ custom: true, phases: { assessment: { status: 'complete' } } }, 'app'),
        ).toEqual({
            custom: true,
            name: 'app',
            phases: {
                assessment: { status: 'complete' },
                discovery: { status: 'not-started' },
            },
        });
    });

    it('rejects non-object JSON roots', () => {
        expect(normalizeMigrationProject([], 'app')).toBeUndefined();
        expect(normalizeMigrationProject(null, 'app')).toBeUndefined();
    });

    it('normalizes legacy empty workspace-root source paths', () => {
        expect(
            normalizeMigrationProject(
                {
                    phases: {
                        discovery: {
                            status: 'not-started',
                            schemaInventory: { path: '', includedFiles: ['schema.sql'] },
                        },
                    },
                },
                'app',
            )?.phases.discovery.schemaInventory,
        ).toEqual({ path: '.', includedFiles: ['schema.sql'] });
    });
});

describe('MigrationProjectService paths', () => {
    it('serializes the workspace root as a portable relative path', () => {
        const workspacePath = path.join(path.sep, 'workspace', 'app');
        const service = new MigrationProjectService(workspacePath);

        expect(service.getRelativePath(workspacePath)).toBe('.');
        expect(service.getRelativePath(path.join(workspacePath, 'database'))).toBe('database');
    });

    it('merges newly selected files with existing files without duplicates', () => {
        const workspacePath = path.join(path.sep, 'workspace', 'app');
        const existingPath = path.join(workspacePath, 'schema', 'existing.sql');
        const newPath = path.join(workspacePath, 'schema', 'new.sql');

        expect(
            MigrationProjectService.mergeFileUris(
                [existingPath],
                [vscode.Uri.file(existingPath), vscode.Uri.file(newPath), vscode.Uri.file(newPath)],
            ).map((uri) => uri.fsPath),
        ).toEqual([existingPath, newPath]);
    });
});

describe('MigrationProjectService default input selections', () => {
    afterEach(() => vi.restoreAllMocks());

    it('normalizes old projects in memory without saving during read-only observation', async () => {
        const service = new MigrationProjectService(path.join(path.sep, 'workspace', 'app'));
        const project = service.createDefaultProject('app');
        delete project.sessionId;
        project.phases.discovery.schemaInventory = { path: '.', includedFiles: ['schema.sql'] };
        vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(Buffer.from(JSON.stringify(project)));
        const save = vi.spyOn(service, 'save').mockResolvedValue(undefined);
        expect(await service.load({ readOnly: true })).toMatchObject({
            phases: { discovery: { schemaInventory: { files: ['../schema.sql'] } } },
        });
        expect(save).not.toHaveBeenCalled();
    });

    it('leaves implicit and exclusion-only sources dynamic when loading selections', async () => {
        const service = new MigrationProjectService(path.join(path.sep, 'workspace', 'app'));
        const project = service.createDefaultProject('app');
        const excluded = { excludedFiles: ['phases/1-discovery/volumetrics/ignored.csv'] };
        project.phases.discovery.volumetrics = excluded;
        const list = vi.spyOn(service, 'listFiles').mockResolvedValue([]);
        expect(await service.normalizeDiscoveryInputs(project)).toBe(false);
        expect(project.phases.discovery.volumetrics).toBe(excluded);
        expect(project.phases.discovery.schemaInventory).toBeUndefined();
        expect(list).not.toHaveBeenCalled();
    });

    it('rebases old default-folder exclusions without making their selection explicit', async () => {
        const service = new MigrationProjectService(path.join(path.sep, 'workspace', 'app'));
        const project = service.createDefaultProject('app');
        project.phases.discovery.volumetrics = { excludedFiles: ['nested/ignored.csv'] };
        const list = vi.spyOn(service, 'listFiles').mockResolvedValue([]);
        expect(await service.normalizeDiscoveryInputs(project)).toBe(true);
        expect(project.phases.discovery.volumetrics).toEqual({
            excludedFiles: ['phases/1-discovery/volumetrics/nested/ignored.csv'],
        });
        expect(await service.normalizeDiscoveryInputs(project)).toBe(false);
        expect(list).not.toHaveBeenCalled();
    });

    it('excludes and restores copied inputs without deleting files or freezing the default folder', async () => {
        const service = new MigrationProjectService(path.join(path.sep, 'workspace', 'app'));
        const project = service.createDefaultProject('app');
        const base = service.getDefaultSubfolderPath('volumetrics');
        const copied = path.join(base, 'workload.csv');
        const added = path.join(base, 'added.csv');
        const list = vi.spyOn(service, 'listFiles').mockResolvedValue([copied]);
        const deleteCalls = vi.mocked(vscode.workspace.fs.delete).mock.calls.length;
        expect(await service.setInputFileExcluded(project, 'volumetrics', copied, true)).toBe(true);
        expect(project.phases.discovery.volumetrics).toEqual({
            excludedFiles: ['phases/1-discovery/volumetrics/workload.csv'],
        });
        expect(await service.listDiscoveryFiles(project, 'volumetrics')).toEqual([]);
        expect(await service.listExcludedDiscoveryFiles(project, 'volumetrics')).toEqual([copied]);
        list.mockResolvedValue([copied, added]);
        expect(await service.listDiscoveryFiles(project, 'volumetrics')).toEqual([added]);
        expect(await service.setInputFileExcluded(project, 'volumetrics', copied, false)).toBe(true);
        expect(project.phases.discovery.volumetrics).toEqual({});
        expect(await service.listDiscoveryFiles(project, 'volumetrics')).toEqual([copied, added]);
        expect(vi.mocked(vscode.workspace.fs.delete).mock.calls.length).toBe(deleteCalls);
    });

    it('excludes referenced and copied files identically while preserving an explicit file list', async () => {
        const workspace = path.join(path.sep, 'workspace', 'app');
        const service = new MigrationProjectService(workspace);
        const project = service.createDefaultProject('app');
        const referenced = path.join(workspace, 'schema.sql');
        const copied = path.join(service.getDefaultSubfolderPath('schema-ddl'), 'copied.sql');
        service.recordInputFiles(project, 'schema-ddl', [referenced, copied]);
        const files = project.phases.discovery.schemaInventory?.files;
        await service.setInputFileExcluded(project, 'schema-ddl', referenced, true);
        await service.setInputFileExcluded(project, 'schema-ddl', copied, true);
        expect(project.phases.discovery.schemaInventory).toEqual({ files, excludedFiles: files });
        expect(await service.listDiscoveryFiles(project, 'schema-ddl')).toEqual([]);
        await service.setInputFileExcluded(project, 'schema-ddl', copied, false);
        expect(project.phases.discovery.schemaInventory?.files).toBe(files);
        expect(await service.listDiscoveryFiles(project, 'schema-ddl')).toEqual([copied]);
        project.phases.discovery.schemaInventory = { files: [] };
        expect(await service.setInputFileExcluded(project, 'schema-ddl', copied, true)).toBe(false);
        expect(await service.listDiscoveryFiles(project, 'schema-ddl')).toEqual([]);
    });

    it.each(['schema-ddl', 'volumetrics', 'access-patterns'] as const)(
        'records copied %s files without turning them into workspace references',
        async (subfolder) => {
            const service = new MigrationProjectService(path.join(path.sep, 'workspace', 'app'));
            const project = service.createDefaultProject('app');
            const base = service.getDefaultSubfolderPath(subfolder);
            const files = [path.join(base, 'second.csv'), path.join(base, 'nested', 'first.csv')];
            const template = service.getTemplateFilePath(subfolder);
            if (template) files.push(template);
            const list = vi.spyOn(service, 'listFiles').mockResolvedValue(files);
            vi.spyOn(MigrationProjectService, 'fileExists').mockResolvedValue(Boolean(template));

            await service.recordDefaultInputFiles(project, subfolder);

            expect(list).toHaveBeenCalledWith(base, true);
            expect(service.getSourceSelection(project, subfolder)).toEqual({
                files: [
                    `phases/1-discovery/${subfolder}/nested/first.csv`,
                    `phases/1-discovery/${subfolder}/second.csv`,
                ],
            });
            expect(service.isWorkspaceReferenced(project, subfolder)).toBe(false);
            expect(service.getDiscoverySourcePath(project, subfolder)).toBe(base);
            expect((await service.listDiscoveryFiles(project, subfolder)).sort()).toEqual(files.sort());
        },
    );

    it('retains unknown source properties and updates the copied file list after removal', async () => {
        const service = new MigrationProjectService(path.join(path.sep, 'workspace', 'app'));
        const project = service.createDefaultProject('app');
        const source = { path: 'inputs', includedFiles: ['old.csv'], excludedFiles: ['other.csv'], custom: true };
        project.phases.discovery.volumetrics = source;
        const list = vi
            .spyOn(service, 'listFiles')
            .mockResolvedValue([path.join(service.getDefaultSubfolderPath('volumetrics'), 'new.csv')]);
        await service.recordDefaultInputFiles(project, 'volumetrics');
        expect(project.phases.discovery.volumetrics).toEqual({
            files: ['phases/1-discovery/volumetrics/new.csv'],
            custom: true,
        });
        list.mockResolvedValue([]);
        await service.recordDefaultInputFiles(project, 'volumetrics');
        expect(project.phases.discovery.volumetrics).toEqual({ files: [], custom: true });
    });

    it('preserves the selection when source enumeration fails', async () => {
        const service = new MigrationProjectService(path.join(path.sep, 'workspace', 'app'));
        const project = service.createDefaultProject('app');
        const source = { includedFiles: ['keep.csv'] };
        project.phases.discovery.volumetrics = source;
        vi.spyOn(service, 'listFiles').mockRejectedValue(new Error('permission denied'));
        await expect(service.recordDefaultInputFiles(project, 'volumetrics')).rejects.toThrow('permission denied');
        expect(project.phases.discovery.volumetrics).toBe(source);
    });

    it('converts existing copied and workspace selections without changing their targets', async () => {
        const workspace = path.join(path.sep, 'workspace', 'app');
        const service = new MigrationProjectService(workspace);
        const project = service.createDefaultProject('app');
        project.phases.discovery.schemaInventory = { path: '.', includedFiles: ['schema.sql'] };
        project.phases.discovery.volumetrics = { includedFiles: ['workload.csv'] };
        vi.spyOn(MigrationProjectService, 'fileExists').mockResolvedValue(false);
        expect(await service.normalizeDiscoveryInputs(project)).toBe(true);
        expect(project.phases.discovery.schemaInventory).toEqual({ files: ['../schema.sql'] });
        expect(project.phases.discovery.volumetrics).toEqual({
            files: ['phases/1-discovery/volumetrics/workload.csv'],
        });
        expect(await service.normalizeDiscoveryInputs(project)).toBe(false);
    });

    it('resolves mixed selections and classifies removal per file rather than per source', async () => {
        const workspace = path.join(path.sep, 'workspace', 'app');
        const service = new MigrationProjectService(workspace);
        const project = service.createDefaultProject('app');
        const referenced = path.join(workspace, 'db', 'schema.sql');
        const copied = path.join(service.getDefaultSubfolderPath('schema-ddl'), 'copy.sql');
        service.recordInputFiles(project, 'schema-ddl', [referenced, copied]);
        expect(project.phases.discovery.schemaInventory).toEqual({
            files: ['../db/schema.sql', 'phases/1-discovery/schema-ddl/copy.sql'],
        });
        expect(await service.listDiscoveryFiles(project, 'schema-ddl')).toEqual([referenced, copied]);
        expect(service.isWorkspaceReferenced(project, 'schema-ddl', referenced)).toBe(true);
        expect(service.isWorkspaceReferenced(project, 'schema-ddl', copied)).toBe(false);
        expect(service.getDiscoveryInputFolders(project)).toContain(path.dirname(referenced));
        expect(() =>
            service.recordInputFiles(project, 'schema-ddl', [path.join(path.sep, 'elsewhere', 'schema.sql')]),
        ).toThrow('Copy external');
        expect(() => service.resolveInputFile('../../outside.sql')).toThrow('remain inside the workspace');
    });

    it('converts folder exclusions and preserves them for restoration with a migration-relative base', async () => {
        const workspace = path.join(path.sep, 'workspace', 'app');
        const service = new MigrationProjectService(workspace);
        const project = service.createDefaultProject('app');
        const kept = path.join(workspace, 'inputs', 'kept.sql');
        const excluded = path.join(workspace, 'inputs', 'excluded.sql');
        project.phases.discovery.schemaInventory = { path: 'inputs', excludedFiles: ['excluded.sql'] };
        vi.spyOn(service, 'listFiles').mockImplementation(async (directory) =>
            directory === path.join(workspace, 'inputs') ? [kept, excluded] : [],
        );
        vi.spyOn(MigrationProjectService, 'fileExists').mockResolvedValue(true);
        await service.normalizeDiscoveryInputs(project);
        expect(project.phases.discovery.schemaInventory).toEqual({
            files: ['../inputs/excluded.sql', '../inputs/kept.sql'],
            excludedFiles: ['../inputs/excluded.sql'],
        });
        expect(await service.listDiscoveryFiles(project, 'schema-ddl')).toEqual([kept]);
        expect(await service.listExcludedDiscoveryFiles(project, 'schema-ddl')).toEqual([excluded]);
    });
});

describe('MigrationProjectService.copyFilesToSubfolder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (vscode.workspace.fs.createDirectory as Mock).mockResolvedValue(undefined);
        (vscode.workspace.fs.copy as Mock).mockResolvedValue(undefined);
    });

    it('preserves nested folder paths for same-named external files', async () => {
        const service = new MigrationProjectService(path.join(path.sep, 'workspace', 'app'));
        const external = path.join(path.sep, 'external');
        await service.copyFilesToSubfolder(
            [
                vscode.Uri.file(path.join(external, 'first', 'workload.csv')),
                vscode.Uri.file(path.join(external, 'second', 'workload.csv')),
            ],
            'volumetrics',
            external,
        );
        const targets = vi.mocked(vscode.workspace.fs.copy).mock.calls.map(([, target]) => target.fsPath);
        expect(targets).toEqual([
            path.join(service.getDefaultSubfolderPath('volumetrics'), 'first', 'workload.csv'),
            path.join(service.getDefaultSubfolderPath('volumetrics'), 'second', 'workload.csv'),
        ]);
    });

    it('keeps files already in the target folder while copying new files', async () => {
        const workspacePath = path.join(path.sep, 'workspace', 'app');
        const service = new MigrationProjectService(workspacePath);
        const targetPath = path.join(
            workspacePath,
            MIGRATION_FOLDER,
            'phases',
            '1-discovery',
            'schema-ddl',
            'existing.sql',
        );
        const newPath = path.join(workspacePath, 'schema', 'new.sql');

        await service.copyFilesToSubfolder([vscode.Uri.file(targetPath), vscode.Uri.file(newPath)], 'schema-ddl');

        expect(vscode.workspace.fs.copy).toHaveBeenCalledTimes(1);
        const [source, target, options] = (vscode.workspace.fs.copy as Mock).mock.calls[0] as [
            vscode.Uri,
            vscode.Uri,
            { overwrite: boolean },
        ];
        expect(source.fsPath).toBe(newPath);
        expect(target.fsPath).toBe(path.join(path.dirname(targetPath), 'new.sql'));
        expect(options).toEqual({ overwrite: true });
    });
});

describe('MigrationProjectService.reset', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (vscode.workspace.fs.createDirectory as Mock).mockResolvedValue(undefined);
        (vscode.workspace.fs.writeFile as Mock).mockResolvedValue(undefined);
        (vscode.workspace.fs.delete as Mock).mockResolvedValue(undefined);
    });

    it('deletes the entire migration root so tooling and abandoned replacements are removed', async () => {
        const workspacePath = path.join(path.sep, 'workspace', 'app');
        const service = new MigrationProjectService(workspacePath);
        const project = service.createDefaultProject('app');

        const resetProject = await service.reset(project);

        expect(vscode.workspace.fs.delete).toHaveBeenCalledWith(
            MigrationProjectService.toUri(workspacePath, MIGRATION_FOLDER),
            { recursive: true, useTrash: false },
        );
        expect(resetProject.name).toBe('app');
        expect(resetProject.runCounts).toEqual({});
        expect(resetProject.phases.discovery.status).toBe('not-started');
    });

    it('does not recreate the project when an existing migration root cannot be deleted', async () => {
        const workspacePath = path.join(path.sep, 'workspace', 'app');
        const service = new MigrationProjectService(workspacePath);
        const project = service.createDefaultProject('app');
        const error = new Error('permission denied');
        (vscode.workspace.fs.delete as Mock).mockRejectedValue(error);
        (vscode.workspace.fs.stat as Mock).mockResolvedValue({});

        await expect(service.reset(project)).rejects.toBe(error);
        expect(vscode.workspace.fs.createDirectory).not.toHaveBeenCalled();
        expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
    });
});
