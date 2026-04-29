/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
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
    sessionId?: string;
    consentGiven?: boolean;
    migrationInstructions?: string;
    migrationMode?: 'plan' | 'start';
    runCounts?: {
        discovery?: number;
        assessment?: number;
        schemaConversion?: number;
        provisioning?: number;
    };
    phases: {
        discovery: {
            status: PhaseStatus;
            discoveryInstructions?: string;
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
        };
        assessment?: {
            status: PhaseStatus;
            assessmentInstructions?: string;
            domains?: AssessmentDomain[];
            parsedAccessPatterns?: ParsedAccessPattern[];
            completedAt?: string;
        };
        schemaConversion?: {
            status: PhaseStatus;
            schemaConversionInstructions?: string;
            domains?: string[];
            completedAt?: string;
        };
        targetEnvironment?: {
            type: 'emulator' | 'azure' | 'provision';
            endpoint?: string;
            accountName?: string;
            tenantId?: string;
            resourceGroup?: string;
            location?: string;
            subscriptionId?: string;
            subscriptionName?: string;
            verified?: boolean;
            verifiedAt?: string;
        };
        provisioning?: {
            status: PhaseStatus;
            databaseName?: string;
            containersCreated?: string[];
            sampleDataInserted?: boolean;
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
    private initialized = false;

    constructor(private readonly workspacePath: string) {
        this.migrationRoot = path.join(workspacePath, MIGRATION_FOLDER);
        this.projectFilePath = path.join(this.migrationRoot, PROJECT_FILE);
    }

    /** Returns the absolute workspace folder path this service is scoped to. */
    public getWorkspacePath(): string {
        return this.workspacePath;
    }

    /**
     * Create a default in-memory project without writing anything to disk.
     */
    createDefaultProject(name: string): ProjectJson {
        return {
            version: 1,
            name,
            sourceCode: 'parent',
            sessionId: crypto.randomUUID(),
            runCounts: {},
            phases: {
                discovery: {
                    status: 'not-started',
                },
            },
        };
    }

    /**
     * Ensure the migration folder structure exists on disk.
     * Called lazily before the first write. Result is cached for the lifetime
     * of the service instance; `reset()` invalidates the cache.
     */
    async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }

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
            path.join(this.migrationRoot, 'phases', '4-provisioning'),
        ];

        for (const folder of folders) {
            await vscode.workspace.fs.createDirectory(MigrationProjectService.toUri(folder));
        }

        this.initialized = true;
    }

    /**
     * Initialize a new migration project with folder structure.
     */
    async initialize(name: string): Promise<ProjectJson> {
        await this.ensureInitialized();

        const project = this.createDefaultProject(name);
        await this.save(project);
        return project;
    }

    /**
     * Load an existing project.json if it exists.
     */
    async load(): Promise<ProjectJson | undefined> {
        try {
            const data = await vscode.workspace.fs.readFile(MigrationProjectService.toUri(this.projectFilePath));
            const project = JSON.parse(Buffer.from(data).toString('utf-8')) as ProjectJson;

            if (!project.sessionId) {
                project.sessionId = crypto.randomUUID();
                await this.save(project);
            }

            return project;
        } catch {
            return undefined;
        }
    }

    /**
     * Save the project.json file.
     * Ensures the migration folder structure is created on the first save.
     */
    async save(project: ProjectJson): Promise<void> {
        await this.ensureInitialized();
        const content = Buffer.from(JSON.stringify(project, null, 2), 'utf-8');
        await vscode.workspace.fs.writeFile(MigrationProjectService.toUri(this.projectFilePath), content);
    }

    /**
     * Reset project by deleting phase subfolders and resetting project.json.
     */
    async reset(project: ProjectJson): Promise<ProjectJson> {
        const phasesDir = MigrationProjectService.toUri(this.migrationRoot, 'phases');
        try {
            await vscode.workspace.fs.delete(phasesDir, { recursive: true });
        } catch {
            // Folder may not exist
        }

        // Invalidate cache so the re-initialize below actually re-creates the phase folders.
        this.initialized = false;

        // Re-create folder structure with a new sessionId
        const newProject = await this.initialize(project.name);
        newProject.sessionId = crypto.randomUUID();
        newProject.runCounts = {};
        await this.save(newProject);
        return newProject;
    }

    /**
     * Check if project.json exists.
     */
    async exists(): Promise<boolean> {
        return MigrationProjectService.fileExists(MigrationProjectService.toUri(this.projectFilePath));
    }

    /**
     * Check if a file or directory exists at the given URI.
     *
     * Wraps `vscode.workspace.fs.stat` + try/catch so call sites don't have to
     * re-implement the boilerplate for an existence check.
     */
    static async fileExists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Build a file-scheme `vscode.Uri` by joining path segments with the
     * platform separator. Shorthand for `vscode.Uri.file(path.join(...segments))`.
     */
    static toUri(...segments: string[]): vscode.Uri {
        return vscode.Uri.file(path.join(...segments));
    }

    /**
     * Get the resolved path for schema files (custom path or default subfolder).
     */
    getSchemaPath(project: ProjectJson): string {
        if (project.phases.discovery.schemaInventory?.path !== undefined) {
            return path.join(this.workspacePath, project.phases.discovery.schemaInventory.path);
        }
        return path.join(this.migrationRoot, 'phases', '1-discovery', 'schema-ddl');
    }

    /**
     * Get the resolved path for volumetrics files.
     */
    getVolumetricsPath(project: ProjectJson): string {
        if (project.phases.discovery.volumetrics?.path !== undefined) {
            return path.join(this.workspacePath, project.phases.discovery.volumetrics.path);
        }
        return path.join(this.migrationRoot, 'phases', '1-discovery', 'volumetrics');
    }

    /**
     * Get the resolved path for access patterns files.
     */
    getAccessPatternsPath(project: ProjectJson): string {
        if (project.phases.discovery.accessPatterns?.path !== undefined) {
            return path.join(this.workspacePath, project.phases.discovery.accessPatterns.path);
        }
        return path.join(this.migrationRoot, 'phases', '1-discovery', 'access-patterns');
    }

    /**
     * Get the default discovery subfolder path (ignoring any custom path overrides).
     * Used for templates and artifacts that must always live inside the migration project structure.
     */
    getDefaultSubfolderPath(subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns'): string {
        return path.join(this.migrationRoot, 'phases', '1-discovery', subfolder);
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
     * Get the resolved path for the 4-provisioning phase root.
     */
    getProvisioningPath(): string {
        return path.join(this.migrationRoot, 'phases', '4-provisioning');
    }

    /**
     * Path to the generated `main.bicep` deployment template inside
     * `phases/4-provisioning/`. The file is purely an export artifact — it is
     * never executed by the extension and is intended for users who prefer to
     * provision manually via `az deployment group create`.
     */
    getBicepPath(): string {
        return path.join(this.getProvisioningPath(), 'main.bicep');
    }

    /**
     * Path to the generated `main.bicepparam` companion params file. Holds the
     * resolved values (account name, location, etc.) that the assistant fills
     * in incrementally as the user proceeds through Phase 4.
     */
    getBicepParamPath(): string {
        return path.join(this.getProvisioningPath(), 'main.bicepparam');
    }

    /**
     * List files in a given directory, recursing into subdirectories.
     */
    async listFiles(dirPath: string): Promise<string[]> {
        const results: string[] = [];
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
            for (const [name, type] of entries) {
                const fullPath = path.join(dirPath, name);
                if ((type & vscode.FileType.Directory) !== 0) {
                    const nested = await this.listFiles(fullPath);
                    results.push(...nested);
                } else if ((type & vscode.FileType.File) !== 0) {
                    results.push(fullPath);
                }
            }
        } catch {
            // Directory does not exist or is unreadable
        }
        return results;
    }

    /**
     * Copy files into a migration subfolder.
     */
    async copyFilesToSubfolder(
        fileUris: vscode.Uri[],
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
    ): Promise<void> {
        const targetDir = path.join(this.migrationRoot, 'phases', '1-discovery', subfolder);
        await vscode.workspace.fs.createDirectory(MigrationProjectService.toUri(targetDir));

        for (const uri of fileUris) {
            const fileName = path.basename(uri.fsPath);
            const targetUri = MigrationProjectService.toUri(targetDir, fileName);
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
        return MigrationProjectService.fileExists(MigrationProjectService.toUri(this.workspacePath, '.git'));
    }

    /**
     * Check if the migration folder is listed in .gitignore.
     */
    async isInGitignore(): Promise<boolean> {
        const gitignorePath = path.join(this.workspacePath, '.gitignore');
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(gitignorePath));
            const lines = Buffer.from(content).toString('utf-8').split(/\r?\n/);
            return lines.some((line) => {
                const trimmed = line.trim();
                return trimmed === MIGRATION_FOLDER || trimmed === MIGRATION_FOLDER + '/';
            });
        } catch {
            return false;
        }
    }

    /**
     * Add the migration folder to .gitignore. Creates the file if it doesn't exist.
     */
    async addToGitignore(): Promise<void> {
        const gitignorePath = path.join(this.workspacePath, '.gitignore');
        const entry = MIGRATION_FOLDER + '/';
        let content = '';
        try {
            const existing = await vscode.workspace.fs.readFile(vscode.Uri.file(gitignorePath));
            content = Buffer.from(existing).toString('utf-8');
        } catch {
            // File doesn't exist yet
        }

        // Check if already present
        const lines = content.split(/\r?\n/);
        if (
            lines.some((line) => {
                const trimmed = line.trim();
                return trimmed === MIGRATION_FOLDER || trimmed === entry;
            })
        ) {
            return;
        }

        // Append with a trailing newline
        const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
        content += separator + entry + '\n';
        await vscode.workspace.fs.writeFile(vscode.Uri.file(gitignorePath), Buffer.from(content, 'utf-8'));
    }

    /**
     * Remove the migration folder from .gitignore.
     */
    async removeFromGitignore(): Promise<void> {
        const gitignorePath = path.join(this.workspacePath, '.gitignore');
        let content: string;
        try {
            const existing = await vscode.workspace.fs.readFile(vscode.Uri.file(gitignorePath));
            content = Buffer.from(existing).toString('utf-8');
        } catch {
            return; // No .gitignore to edit
        }

        const entry = MIGRATION_FOLDER + '/';
        const lines = content.split(/\r?\n/);
        const filtered = lines.filter((line) => {
            const trimmed = line.trim();
            return trimmed !== MIGRATION_FOLDER && trimmed !== entry;
        });

        if (filtered.length !== lines.length) {
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(gitignorePath),
                Buffer.from(filtered.join('\n'), 'utf-8'),
            );
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
