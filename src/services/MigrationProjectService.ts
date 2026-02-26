/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { type ParsedAccessPattern } from '../panels/migration/helpers/migrationHelpers';

export const MIGRATION_FOLDER = '.cosmosdb-migration';
export const PROJECT_FILE = 'project.json';

export type PhaseStatus = 'not-started' | 'in-progress' | 'complete';

export interface AssessmentDomain {
    name: string;
    tables: string[];
    crossDomainDependencies: string[];
    estimatedTokens: number;
    isMapped: boolean;
}

export interface ProjectJson {
    version: 1;
    name: string;
    sourceCode: 'parent';
    phases: {
        discovery: {
            status: PhaseStatus;
            schemaInventory?: {
                path?: string;
            };
            volumetrics?: {
                path?: string;
            };
            accessPatterns?: {
                path?: string;
            };
            applicationAnalysis?: {
                projectName?: string;
                projectType?: string;
                language?: string;
                frameworks?: string[];
                databaseType?: string;
                databaseAccess?: string;
                completedAt?: string;
            };
            targetEnvironment?: {
                type: 'emulator' | 'azure';
                connectionString?: string;
                verified?: boolean;
                verifiedAt?: string;
            };
        };
        assessment?: {
            status: PhaseStatus;
            domains?: AssessmentDomain[];
            parsedAccessPatterns?: ParsedAccessPattern[];
            completedAt?: string;
        };
        schemaConversion?: {
            status: PhaseStatus;
            domains?: string[];
            completedAt?: string;
        };
    };
}

/**
 * Manages the `.cosmosdb-migration/project.json` file and folder structure on disk.
 */
export class MigrationProjectService {
    private readonly migrationRoot: string;
    private readonly projectFilePath: string;

    constructor(private readonly workspacePath: string) {
        this.migrationRoot = path.join(workspacePath, MIGRATION_FOLDER);
        this.projectFilePath = path.join(this.migrationRoot, PROJECT_FILE);
    }

    /**
     * Initialize a new migration project with folder structure.
     */
    async initialize(name: string): Promise<ProjectJson> {
        const folders = [
            this.migrationRoot,
            path.join(this.migrationRoot, 'phases'),
            path.join(this.migrationRoot, 'phases', '1-discovery'),
            path.join(this.migrationRoot, 'phases', '1-discovery', 'schema-ddl'),
            path.join(this.migrationRoot, 'phases', '1-discovery', 'volumetrics'),
            path.join(this.migrationRoot, 'phases', '1-discovery', 'access-patterns'),
            path.join(this.migrationRoot, 'phases', '2-assessment'),
            path.join(this.migrationRoot, 'phases', '2-assessment', 'domains'),
            path.join(this.migrationRoot, 'phases', '3-schema-conversion'),
            path.join(this.migrationRoot, 'phases', '3-schema-conversion', 'domains'),
        ];

        for (const folder of folders) {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(folder));
        }

        const project: ProjectJson = {
            version: 1,
            name,
            sourceCode: 'parent',
            phases: {
                discovery: {
                    status: 'not-started',
                },
            },
        };

        await this.save(project);
        return project;
    }

    /**
     * Load an existing project.json if it exists.
     */
    async load(): Promise<ProjectJson | undefined> {
        try {
            const data = await vscode.workspace.fs.readFile(vscode.Uri.file(this.projectFilePath));
            return JSON.parse(Buffer.from(data).toString('utf-8')) as ProjectJson;
        } catch {
            return undefined;
        }
    }

    /**
     * Save the project.json file.
     */
    async save(project: ProjectJson): Promise<void> {
        const content = Buffer.from(JSON.stringify(project, null, 2), 'utf-8');
        await vscode.workspace.fs.writeFile(vscode.Uri.file(this.projectFilePath), content);
    }

    /**
     * Reset project by deleting phase subfolders and resetting project.json.
     */
    async reset(project: ProjectJson): Promise<ProjectJson> {
        const phasesDir = vscode.Uri.file(path.join(this.migrationRoot, 'phases'));
        try {
            await vscode.workspace.fs.delete(phasesDir, { recursive: true });
        } catch {
            // Folder may not exist
        }

        // Re-create folder structure
        return this.initialize(project.name);
    }

    /**
     * Check if project.json exists.
     */
    async exists(): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(this.projectFilePath));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get the resolved path for schema files (custom path or default subfolder).
     */
    getSchemaPath(project: ProjectJson): string {
        if (project.phases.discovery.schemaInventory?.path) {
            return path.join(this.workspacePath, project.phases.discovery.schemaInventory.path);
        }
        return path.join(this.migrationRoot, 'phases', '1-discovery', 'schema-ddl');
    }

    /**
     * Get the resolved path for volumetrics files.
     */
    getVolumetricsPath(project: ProjectJson): string {
        if (project.phases.discovery.volumetrics?.path) {
            return path.join(this.workspacePath, project.phases.discovery.volumetrics.path);
        }
        return path.join(this.migrationRoot, 'phases', '1-discovery', 'volumetrics');
    }

    /**
     * Get the resolved path for access patterns files.
     */
    getAccessPatternsPath(project: ProjectJson): string {
        if (project.phases.discovery.accessPatterns?.path) {
            return path.join(this.workspacePath, project.phases.discovery.accessPatterns.path);
        }
        return path.join(this.migrationRoot, 'phases', '1-discovery', 'access-patterns');
    }

    /**
     * Get the resolved path for the 1-discovery phase root.
     */
    getDiscoveryPath(): string {
        return path.join(this.migrationRoot, 'phases', '1-discovery');
    }

    /**
     * Get the resolved path for the 2-assessment phase root.
     */
    getAssessmentPath(): string {
        return path.join(this.migrationRoot, 'phases', '2-assessment');
    }

    /**
     * Get the resolved path for the 3-schema-conversion phase root.
     */
    getSchemaConversionPath(): string {
        return path.join(this.migrationRoot, 'phases', '3-schema-conversion');
    }

    /**
     * List files in a given directory.
     */
    async listFiles(dirPath: string): Promise<string[]> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
            return entries
                .filter(([, type]) => type === vscode.FileType.File)
                .map(([name]) => path.join(dirPath, name));
        } catch {
            return [];
        }
    }

    /**
     * Copy files into a migration subfolder.
     */
    async copyFilesToSubfolder(
        fileUris: vscode.Uri[],
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
    ): Promise<void> {
        const targetDir = path.join(this.migrationRoot, 'phases', '1-discovery', subfolder);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));

        for (const uri of fileUris) {
            const fileName = path.basename(uri.fsPath);
            const targetUri = vscode.Uri.file(path.join(targetDir, fileName));
            await vscode.workspace.fs.copy(uri, targetUri, { overwrite: true });
        }
    }

    /**
     * Check if a path is inside the workspace.
     */
    isInsideWorkspace(fsPath: string): boolean {
        const normalized = path.normalize(fsPath);
        const normalizedWorkspace = path.normalize(this.workspacePath);
        return normalized.startsWith(normalizedWorkspace + path.sep) || normalized === normalizedWorkspace;
    }

    /**
     * Get a relative path from the workspace root.
     */
    getRelativePath(fsPath: string): string {
        return path.relative(this.workspacePath, fsPath);
    }

    /**
     * Check if the workspace has a git repository.
     */
    async hasGitRepository(): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(path.join(this.workspacePath, '.git')));
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Detect an existing migration project in a workspace.
     */
    static async detectInWorkspace(workspacePath: string): Promise<boolean> {
        const service = new MigrationProjectService(workspacePath);
        return service.exists();
    }
}
