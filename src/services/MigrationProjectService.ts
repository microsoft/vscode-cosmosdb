/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { type ParsedAccessPattern } from '../panels/migration/helpers/migrationHelpers';

export const MIGRATION_FOLDER = '.cosmosdb-migration';
export const PROJECT_FILE = 'project.json';

export type PhaseStatus = 'not-started' | 'in-progress' | 'complete';

export interface DiscoverySourceSelection {
    files?: string[];
    excludedFiles?: string[];
    path?: string;
    includedFiles?: string[];
}

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
            preflightStatus?: PhaseStatus;
            preflightCompletedAt?: string;
            status: PhaseStatus;
            discoveryInstructions?: string;
            schemaInventory?: DiscoverySourceSelection;
            volumetrics?: DiscoverySourceSelection;
            accessPatterns?: DiscoverySourceSelection;
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
            thoroughAnalysis?: boolean;
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
            capacityMode?: 'serverless' | 'provisioned';
            maxThroughput?: number;
            verified?: boolean;
            verifiedAt?: string;
        };
        provisioning?: {
            status: PhaseStatus;
            databaseName?: string;
            containersCreated?: string[];
            sampleDataInserted?: boolean;
            artifactPaths?: string[];
            completedAt?: string;
        };
        codeMigration?: {
            status: PhaseStatus;
            planPath?: string;
            outputPaths?: string[];
            completedAt?: string;
        };
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDiscoverySource(value: unknown): unknown {
    return isRecord(value) && value.path === '' ? { ...value, path: '.' } : value;
}

function hasLegacyWorkspaceRootPath(value: unknown): boolean {
    if (!isRecord(value) || !isRecord(value.phases) || !isRecord(value.phases.discovery)) return false;
    const discovery = value.phases.discovery;
    return [discovery.schemaInventory, discovery.volumetrics, discovery.accessPatterns].some(
        (source) => isRecord(source) && source.path === '',
    );
}

export function normalizeMigrationProject(value: unknown, defaultName: string): ProjectJson | undefined {
    if (!isRecord(value)) return undefined;

    const phases = isRecord(value.phases) ? value.phases : {};
    const discovery = isRecord(phases.discovery) ? phases.discovery : {};
    const status = ['not-started', 'in-progress', 'complete'].includes(String(discovery.status))
        ? discovery.status
        : 'not-started';

    return {
        ...value,
        name: typeof value.name === 'string' && value.name.length > 0 ? value.name : defaultName,
        phases: {
            ...phases,
            discovery: {
                ...discovery,
                schemaInventory: normalizeDiscoverySource(discovery.schemaInventory),
                volumetrics: normalizeDiscoverySource(discovery.volumetrics),
                accessPatterns: normalizeDiscoverySource(discovery.accessPatterns),
                status,
            },
        },
    } as ProjectJson;
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
            sessionId: globalThis.crypto.randomUUID(),
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
    async load(options: { readOnly?: boolean } = {}): Promise<ProjectJson | undefined> {
        try {
            const data = await vscode.workspace.fs.readFile(MigrationProjectService.toUri(this.projectFilePath));
            const parsed: unknown = JSON.parse(Buffer.from(data).toString('utf-8'));
            const project = normalizeMigrationProject(parsed, path.basename(this.workspacePath));
            if (!project) return undefined;

            const wasMissingSessionId = !project.sessionId;
            const shouldPersistNormalizedPaths = hasLegacyWorkspaceRootPath(parsed);
            if (wasMissingSessionId && !options.readOnly) {
                project.sessionId = globalThis.crypto.randomUUID();
            }
            const inputsNormalized = await this.normalizeDiscoveryInputs(project);
            if (!options.readOnly && (wasMissingSessionId || shouldPersistNormalizedPaths || inputsNormalized)) {
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
     * Reset project by deleting the entire migration folder and creating a new project.
     */
    async reset(project: ProjectJson): Promise<ProjectJson> {
        const migrationRoot = MigrationProjectService.toUri(this.migrationRoot);
        try {
            await vscode.workspace.fs.delete(migrationRoot, { recursive: true, useTrash: false });
        } catch (error) {
            if (await MigrationProjectService.fileExists(migrationRoot)) {
                throw error;
            }
        }

        this.initialized = false;
        return this.initialize(project.name);
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

    isWorkspaceReferenced(
        project: ProjectJson,
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
        filePath?: string,
    ): boolean {
        const selection = this.getSourceSelection(project, subfolder);
        const isReference = (file: string) => {
            const relative = path.relative(this.getDefaultSubfolderPath(subfolder), file);
            return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
        };
        if (filePath !== undefined) return isReference(filePath);
        return selection?.files !== undefined
            ? selection.files.some((file) => isReference(this.resolveInputFile(file)))
            : selection?.path !== undefined;
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
    async listFiles(dirPath: string, strict = false): Promise<string[]> {
        const results: string[] = [];
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath));
            for (const [name, type] of entries) {
                const fullPath = path.join(dirPath, name);
                if ((type & vscode.FileType.Directory) !== 0) {
                    const nested = await this.listFiles(fullPath, strict);
                    results.push(...nested);
                } else if ((type & vscode.FileType.File) !== 0) {
                    results.push(fullPath);
                }
            }
        } catch (error) {
            if (strict) throw error;
            // Directory does not exist or is unreadable
        }
        return results;
    }

    async recordDefaultInputFiles(
        project: ProjectJson,
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
    ): Promise<void> {
        const base = this.getDefaultSubfolderPath(subfolder);
        const files = await this.listFiles(base, true);
        this.recordInputFiles(project, subfolder, files);
    }

    getSourceSelection(
        project: ProjectJson,
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
    ): DiscoverySourceSelection | undefined {
        const property =
            subfolder === 'schema-ddl'
                ? 'schemaInventory'
                : subfolder === 'volumetrics'
                  ? 'volumetrics'
                  : 'accessPatterns';
        return project.phases.discovery[property];
    }

    resolveInputFile(file: string): string {
        const resolved = path.resolve(this.migrationRoot, file);
        if (path.isAbsolute(file) || !this.isInsideWorkspace(resolved)) {
            throw new Error(
                l10n.t('Discovery input must be relative to the migration folder and remain inside the workspace.'),
            );
        }
        return resolved;
    }

    recordInputFiles(
        project: ProjectJson,
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
        files: string[],
        excludedFiles: string[] = [],
    ): void {
        const toRelative = (file: string) => {
            if (!this.isInsideWorkspace(file))
                throw new Error(l10n.t('Copy external inputs into the workspace before recording them.'));
            return path.relative(this.migrationRoot, file).split(path.sep).join('/');
        };
        const property =
            subfolder === 'schema-ddl'
                ? 'schemaInventory'
                : subfolder === 'volumetrics'
                  ? 'volumetrics'
                  : 'accessPatterns';
        const source: DiscoverySourceSelection = { ...project.phases.discovery[property] };
        delete source.path;
        delete source.includedFiles;
        delete source.excludedFiles;
        const template = this.getTemplateFilePath(subfolder);
        source.files = [...new Set(files.filter((file) => file !== template).map(toRelative))].sort();
        const excluded = [...new Set(excludedFiles.map(toRelative))]
            .filter((file) => source.files?.includes(file))
            .sort();
        if (excluded.length) source.excludedFiles = excluded;
        project.phases.discovery[property] = source;
    }

    async normalizeDiscoveryInputs(project: ProjectJson): Promise<boolean> {
        let changed = false;
        for (const subfolder of ['schema-ddl', 'volumetrics', 'access-patterns'] as const) {
            const source = this.getSourceSelection(project, subfolder);
            if (source?.files !== undefined) continue;
            if (source?.path === undefined && source?.includedFiles === undefined) {
                const excluded = source?.excludedFiles?.map((file) => {
                    const normalized = file.replace(/\\/g, '/');
                    if (normalized.startsWith('phases/') || normalized.startsWith('../') || path.isAbsolute(normalized))
                        return normalized;
                    return path
                        .relative(this.migrationRoot, path.resolve(this.getDefaultSubfolderPath(subfolder), normalized))
                        .split(path.sep)
                        .join('/');
                });
                if (source && JSON.stringify(excluded) !== JSON.stringify(source.excludedFiles)) {
                    source.excludedFiles = excluded;
                    changed = true;
                }
                continue;
            }
            const base = this.getDiscoverySourcePath(project, subfolder);
            if (
                source.includedFiles === undefined &&
                path.resolve(base) === path.resolve(this.getDefaultSubfolderPath(subfolder))
            ) {
                const normalized = { ...source };
                delete normalized.path;
                if (source.excludedFiles) {
                    normalized.excludedFiles = source.excludedFiles.map((file) =>
                        path.relative(this.migrationRoot, path.resolve(base, file)).split(path.sep).join('/'),
                    );
                }
                const property =
                    subfolder === 'schema-ddl'
                        ? 'schemaInventory'
                        : subfolder === 'volumetrics'
                          ? 'volumetrics'
                          : 'accessPatterns';
                project.phases.discovery[property] = normalized;
                changed = true;
                continue;
            }
            if (
                source?.includedFiles === undefined &&
                !(await MigrationProjectService.fileExists(vscode.Uri.file(base)))
            )
                continue;
            const files =
                source?.includedFiles !== undefined
                    ? source.includedFiles.map((file) => path.resolve(base, file))
                    : await this.listFiles(base, true);
            const rawFiles = files.filter((file) => file !== this.getTemplateFilePath(subfolder));
            if (!source && !rawFiles.length) continue;
            this.recordInputFiles(
                project,
                subfolder,
                rawFiles,
                (source?.excludedFiles ?? []).map((file) => path.resolve(base, file)),
            );
            changed = true;
        }
        return changed;
    }

    async setInputFileExcluded(
        project: ProjectJson,
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
        filePath: string,
        excluded: boolean,
    ): Promise<boolean> {
        await this.normalizeDiscoveryInputs(project);
        const source = this.getSourceSelection(project, subfolder);
        const relative = path.relative(this.migrationRoot, filePath).split(path.sep).join('/');
        const resolved = this.resolveInputFile(relative);
        if (resolved === this.getTemplateFilePath(subfolder)) return false;
        const exclusions = new Set(source?.excludedFiles ?? []);
        if (exclusions.has(relative) === excluded) return false;
        const candidates =
            source?.files !== undefined
                ? source.files.map((file) => this.resolveInputFile(file))
                : await this.listFiles(this.getDefaultSubfolderPath(subfolder), true);
        if (!candidates.includes(resolved)) return false;
        if (excluded) exclusions.add(relative);
        else exclusions.delete(relative);
        const updated = { ...source };
        if (exclusions.size) updated.excludedFiles = [...exclusions].sort();
        else delete updated.excludedFiles;
        const property =
            subfolder === 'schema-ddl'
                ? 'schemaInventory'
                : subfolder === 'volumetrics'
                  ? 'volumetrics'
                  : 'accessPatterns';
        project.phases.discovery[property] = updated;
        return true;
    }

    getDiscoveryInputFolders(project: ProjectJson): string[] {
        return [
            ...new Set(
                (['schema-ddl', 'volumetrics', 'access-patterns'] as const).flatMap((subfolder) => {
                    const source = this.getSourceSelection(project, subfolder);
                    return source?.files !== undefined
                        ? [
                              this.getDefaultSubfolderPath(subfolder),
                              ...source.files.map((file) => path.dirname(this.resolveInputFile(file))),
                          ]
                        : [this.getDiscoverySourcePath(project, subfolder)];
                }),
            ),
        ];
    }

    /**
     * List discovery source files for a subfolder, applying the per-source
     * `includedFiles` allowlist and `excludedFiles` filter from project.json
     * (paths relative to the resolved base).
     *
     * NOTE: The curated template files (`volumetrics.md`, `access-patterns.md`)
     * ARE included in the result when they live in the source folder, because
     * downstream discovery/assessment steps extract them by name to read
     * pre-filled values. UI callers that need to hide them should filter the
     * template file out themselves (see {@link getTemplateFilePath}).
     */
    async listDiscoveryFiles(
        project: ProjectJson,
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
    ): Promise<string[]> {
        const source = this.getSourceSelection(project, subfolder);
        if (source?.files !== undefined) {
            const excluded = new Set((source.excludedFiles ?? []).map((file) => this.resolveInputFile(file)));
            const files = source.files.map((file) => this.resolveInputFile(file)).filter((file) => !excluded.has(file));
            const template = this.getTemplateFilePath(subfolder);
            if (template && (await MigrationProjectService.fileExists(vscode.Uri.file(template)))) files.push(template);
            return [...new Set(files)];
        }
        const base = this.getDiscoverySourcePath(project, subfolder);
        const all = await this.listFiles(base);
        const included = this.getIncludedFiles(project, subfolder);
        let filtered = all;
        if (included !== undefined) {
            const allow = new Set(included.map((file) => path.normalize(file)));
            const template = this.getTemplateFilePath(subfolder);
            filtered = filtered.filter((file) => allow.has(path.relative(base, file)) || file === template);
        }
        const legacyBase = source?.path !== undefined || source?.includedFiles !== undefined;
        const excluded = new Set(
            this.getExcludedFiles(project, subfolder).map((file) =>
                legacyBase ? path.resolve(base, file) : this.resolveInputFile(file),
            ),
        );
        if (excluded.size > 0) {
            filtered = filtered.filter((file) => !excluded.has(path.resolve(file)));
        }
        return filtered;
    }

    /**
     * Return the absolute path of the curated template file for the given
     * discovery subfolder (`volumetrics.md` / `access-patterns.md`), or
     * `undefined` for subfolders that have no template. The template always
     * lives in the default subfolder path; callers can use this to suppress
     * the template from UI file lists without affecting AI flows that need to
     * read it.
     */
    getTemplateFilePath(subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns'): string | undefined {
        const templateFileName =
            subfolder === 'volumetrics'
                ? 'volumetrics.md'
                : subfolder === 'access-patterns'
                  ? 'access-patterns.md'
                  : undefined;
        if (templateFileName === undefined) return undefined;
        return path.join(this.getDefaultSubfolderPath(subfolder), templateFileName);
    }

    /**
     * List the absolute paths of the discovery files that are currently excluded
     * (paths preserved relative to the resolved base; only those still present on
     * disk are returned). Returns empty when an `includedFiles` allowlist is set,
     * since the "excluded sibling" concept only applies in folder-selection mode.
     */
    async listExcludedDiscoveryFiles(
        project: ProjectJson,
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
    ): Promise<string[]> {
        const source = this.getSourceSelection(project, subfolder);
        if (source?.files !== undefined) {
            const files = (source.excludedFiles ?? [])
                .filter((file) => source.files?.includes(file))
                .map((file) => this.resolveInputFile(file));
            const present = await Promise.all(
                files.map((file) => MigrationProjectService.fileExists(vscode.Uri.file(file))),
            );
            return files.filter((_, index) => present[index]);
        }
        if (this.getIncludedFiles(project, subfolder) !== undefined) return [];
        const excluded = this.getExcludedFiles(project, subfolder);
        if (excluded.length === 0) return [];
        const base = this.getDiscoverySourcePath(project, subfolder);
        const all = new Set(await this.listFiles(base));
        return excluded
            .map((file) => (source?.path !== undefined ? path.resolve(base, file) : this.resolveInputFile(file)))
            .filter((file) => all.has(file) && file !== this.getTemplateFilePath(subfolder));
    }

    /**
     * Resolve the discovery source path for a subfolder (custom path or default).
     */
    getDiscoverySourcePath(project: ProjectJson, subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns'): string {
        switch (subfolder) {
            case 'schema-ddl':
                return this.getSchemaPath(project);
            case 'volumetrics':
                return this.getVolumetricsPath(project);
            case 'access-patterns':
                return this.getAccessPatternsPath(project);
        }
    }

    /**
     * Read the configured `excludedFiles` list for a discovery source.
     */
    getExcludedFiles(project: ProjectJson, subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns'): string[] {
        const d = project.phases.discovery;
        switch (subfolder) {
            case 'schema-ddl':
                return d.schemaInventory?.excludedFiles ?? [];
            case 'volumetrics':
                return d.volumetrics?.excludedFiles ?? [];
            case 'access-patterns':
                return d.accessPatterns?.excludedFiles ?? [];
        }
    }

    /**
     * Read the configured `includedFiles` allowlist for a discovery source.
     * Returns `undefined` when no allowlist is configured (meaning: all files
     * under `path` are considered).
     */
    getIncludedFiles(
        project: ProjectJson,
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
    ): string[] | undefined {
        const d = project.phases.discovery;
        switch (subfolder) {
            case 'schema-ddl':
                return d.schemaInventory?.includedFiles;
            case 'volumetrics':
                return d.volumetrics?.includedFiles;
            case 'access-patterns':
                return d.accessPatterns?.includedFiles;
        }
    }

    /**
     * Merge existing discovery file paths with files newly selected by the user.
     */
    static mergeFileUris(existingFilePaths: string[], selectedFileUris: vscode.Uri[]): vscode.Uri[] {
        const filesByPath = new Map<string, vscode.Uri>();
        for (const filePath of existingFilePaths) {
            filesByPath.set(path.normalize(filePath), vscode.Uri.file(filePath));
        }
        for (const uri of selectedFileUris) {
            filesByPath.set(path.normalize(uri.fsPath), uri);
        }
        return [...filesByPath.values()];
    }

    /**
     * Copy files into a migration subfolder.
     */
    async copyFilesToSubfolder(
        fileUris: vscode.Uri[],
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
        sourceFolder?: string,
    ): Promise<void> {
        const targetDir = path.join(this.migrationRoot, 'phases', '1-discovery', subfolder);
        await vscode.workspace.fs.createDirectory(MigrationProjectService.toUri(targetDir));

        for (const uri of fileUris) {
            const fileName = sourceFolder ? path.relative(sourceFolder, uri.fsPath) : path.basename(uri.fsPath);
            if (fileName === '..' || fileName.startsWith(`..${path.sep}`) || path.isAbsolute(fileName)) {
                throw new Error(l10n.t('Copied input must remain inside its selected folder.'));
            }
            const targetUri = MigrationProjectService.toUri(targetDir, fileName);
            if (path.relative(uri.fsPath, targetUri.fsPath) === '') continue;
            await vscode.workspace.fs.createDirectory(MigrationProjectService.toUri(path.dirname(targetUri.fsPath)));
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
        return path.relative(this.workspacePath, fsPath) || '.';
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
