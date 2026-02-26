/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { extractStructuralDDL } from '../../../utils/ddlExtractor';

// ─── Tool Definitions ────────────────────────────────────────────────

export const SCHEMA_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'listSchemaFiles',
        description:
            'Lists all schema DDL file names available in the migration project. Returns file names only, not contents.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'readSchemaFile',
        description:
            'Reads the structural DDL content of a single schema file. For SQL files, only CREATE/ALTER statements are returned. For CSV files, only the header and first data row are returned.',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: {
                    type: 'string',
                    description: 'The exact file name to read (as returned by listSchemaFiles).',
                },
            },
            required: ['fileName'],
        },
    },
];

export const ACCESS_PATTERN_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'listAccessPatternFiles',
        description:
            'Lists user-provided access pattern documentation files. These contain known access patterns, query logs, or usage notes.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'readAccessPatternFile',
        description: 'Reads the content of a user-provided access pattern file.',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: {
                    type: 'string',
                    description: 'The exact file name to read (as returned by listAccessPatternFiles).',
                },
            },
            required: ['fileName'],
        },
    },
];

export const VOLUMETRIC_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'listVolumetricFiles',
        description:
            'Lists user-provided volumetric data files (query logs, AWR reports, usage statistics). These contain quantitative data about database usage.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'readVolumetricFile',
        description: 'Reads the content of a user-provided volumetric data file.',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: {
                    type: 'string',
                    description: 'The exact file name to read (as returned by listVolumetricFiles).',
                },
            },
            required: ['fileName'],
        },
    },
];

export const WORKSPACE_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'listWorkspaceFiles',
        description:
            'Lists source code files in the workspace that may contain database access patterns, queries, or data layer code. ' +
            'Returns relative file paths. Use this to discover application code that interacts with the database.',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description:
                        'A glob pattern to filter files (e.g. "**/*.cs", "**/repository/**", "**/*Service*.ts"). ' +
                        'Defaults to common source file extensions if not specified.',
                },
            },
        },
    },
    {
        name: 'readWorkspaceFile',
        description:
            'Reads the content of a source code file from the workspace. Use this to examine how the application accesses the database ' +
            '(queries, ORM mappings, repository patterns, stored procedure calls, etc.).',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'The relative file path to read (as returned by listWorkspaceFiles).',
                },
            },
            required: ['filePath'],
        },
    },
];

/** Returns all discovery tools (schema + access patterns + volumetrics + workspace). */
export function getAllDiscoveryTools(): vscode.LanguageModelChatTool[] {
    return [...SCHEMA_TOOLS, ...ACCESS_PATTERN_TOOLS, ...VOLUMETRIC_TOOLS, ...WORKSPACE_TOOLS];
}

// ─── Tool Executor ───────────────────────────────────────────────────

export interface ToolFileMaps {
    schemaFileMap?: Map<string, string>;
    accessPatternFileMap?: Map<string, string>;
    volumetricFileMap?: Map<string, string>;
}

const BASE_WORKSPACE_EXCLUDES = ['**/node_modules/**', '**/.cosmos-migration/**', '**/.git/**'];

/** Framework-specific folder exclusions, keyed by lowercase framework/language substrings. */
const FRAMEWORK_EXCLUDES: Record<string, string[]> = {
    '.net': ['**/bin/**', '**/obj/**', '**/out/**'],
    'c#': ['**/bin/**', '**/obj/**', '**/out/**'],
    'asp.net': ['**/bin/**', '**/obj/**', '**/out/**', '**/wwwroot/lib/**'],
    'entity framework': ['**/Migrations/**'],
    java: ['**/target/**', '**/build/**', '**/.gradle/**'],
    spring: ['**/target/**', '**/build/**', '**/.gradle/**'],
    hibernate: ['**/target/**', '**/build/**'],
    node: ['**/dist/**', '**/out/**', '**/build/**', '**/.next/**', '**/.nuxt/**'],
    typescript: ['**/dist/**', '**/out/**', '**/build/**'],
    javascript: ['**/dist/**', '**/out/**', '**/build/**'],
    express: ['**/dist/**', '**/out/**'],
    python: ['**/__pycache__/**', '**/.venv/**', '**/venv/**', '**/*.egg-info/**', '**/dist/**', '**/build/**'],
    django: ['**/__pycache__/**', '**/.venv/**', '**/venv/**', '**/staticfiles/**'],
    flask: ['**/__pycache__/**', '**/.venv/**', '**/venv/**'],
    go: ['**/vendor/**'],
    ruby: ['**/vendor/**', '**/tmp/**'],
    rust: ['**/target/**'],
    php: ['**/vendor/**'],
};

function getWorkspaceFileExclude(language?: string, frameworks?: string[]): string {
    const excludes = new Set(BASE_WORKSPACE_EXCLUDES);
    const hints = [language ?? '', ...(frameworks ?? [])].map((s) => s.toLowerCase());
    for (const hint of hints) {
        for (const [key, patterns] of Object.entries(FRAMEWORK_EXCLUDES)) {
            if (hint.includes(key)) {
                for (const p of patterns) excludes.add(p);
            }
        }
    }
    return `{${Array.from(excludes).join(',')}}`;
}

const DEFAULT_SOURCE_PATTERN = '**/*.{ts,js,cs,java,py,go,rb,rs,php,kt,scala,sql}';
const MAX_WORKSPACE_FILES = 50;
const MAX_FILE_CHARS = 10000;

/**
 * Creates a unified tool executor function that handles all migration AI tools.
 * Pass in file maps for schema/access-pattern/volumetric tools; workspace tools
 * always work against the current VS Code workspace.
 *
 * @param fileMaps Optional lookup maps for file-based tools.
 * @param logPrefix Optional prefix for output channel logging (e.g. "[Discovery]").
 */
export function createToolExecutor(
    fileMaps: ToolFileMaps = {},
    logPrefix?: string,
    languageContext?: { language?: string; frameworks?: string[] },
): (toolCall: vscode.LanguageModelToolCallPart) => Promise<string> {
    const { schemaFileMap, accessPatternFileMap, volumetricFileMap } = fileMaps;
    const workspaceFileExclude = getWorkspaceFileExclude(languageContext?.language, languageContext?.frameworks);

    return async (toolCall: vscode.LanguageModelToolCallPart): Promise<string> => {
        const input = toolCall.input as Record<string, string>;

        switch (toolCall.name) {
            // ── Schema tools ──
            case 'listSchemaFiles':
                return schemaFileMap ? Array.from(schemaFileMap.keys()).join('\n') : 'No schema files available.';

            case 'readSchemaFile': {
                if (!schemaFileMap) return 'No schema files available.';
                const absolutePath = schemaFileMap.get(input.fileName);
                if (!absolutePath) {
                    return `Error: File "${input.fileName}" not found. Use listSchemaFiles to see available files.`;
                }
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
                    const rawText = Buffer.from(content).toString('utf-8');
                    const fileExt = path.extname(input.fileName).toLowerCase();
                    if (fileExt === '.sql') return extractStructuralDDL(rawText);
                    if (fileExt === '.csv') return rawText.split('\n').slice(0, 2).join('\n');
                    return rawText;
                } catch {
                    return `Error: Could not read file "${input.fileName}".`;
                }
            }

            // ── Access pattern tools ──
            case 'listAccessPatternFiles':
                return accessPatternFileMap && accessPatternFileMap.size > 0
                    ? Array.from(accessPatternFileMap.keys()).join('\n')
                    : 'No user-provided access pattern files available.';

            case 'readAccessPatternFile': {
                if (!accessPatternFileMap) return 'No access pattern files available.';
                const absolutePath = accessPatternFileMap.get(input.fileName);
                if (!absolutePath) {
                    return `Error: File "${input.fileName}" not found. Use listAccessPatternFiles to see available files.`;
                }
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
                    return Buffer.from(content).toString('utf-8');
                } catch {
                    return `Error: Could not read file "${input.fileName}".`;
                }
            }

            // ── Volumetric tools ──
            case 'listVolumetricFiles':
                return volumetricFileMap && volumetricFileMap.size > 0
                    ? Array.from(volumetricFileMap.keys()).join('\n')
                    : 'No volumetric data files available.';

            case 'readVolumetricFile': {
                if (!volumetricFileMap) return 'No volumetric files available.';
                const absolutePath = volumetricFileMap.get(input.fileName);
                if (!absolutePath) {
                    return `Error: File "${input.fileName}" not found. Use listVolumetricFiles to see available files.`;
                }
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
                    return Buffer.from(content).toString('utf-8');
                } catch {
                    return `Error: Could not read file "${input.fileName}".`;
                }
            }

            // ── Workspace tools ──
            case 'listWorkspaceFiles': {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) return 'No workspace folder open.';

                const pattern = input.pattern || DEFAULT_SOURCE_PATTERN;
                const files = await vscode.workspace.findFiles(pattern, workspaceFileExclude, MAX_WORKSPACE_FILES);

                if (files.length === 0) {
                    if (logPrefix) {
                        ext.outputChannel.appendLog(`${logPrefix} listWorkspaceFiles("${pattern}"): 0 files found`);
                    }
                    return `No files found matching pattern "${pattern}".`;
                }

                const relativePaths = files.map((f) => vscode.workspace.asRelativePath(f)).sort();
                if (logPrefix) {
                    ext.outputChannel.appendLog(
                        `${logPrefix} listWorkspaceFiles("${pattern}"): ${relativePaths.length} files\n${relativePaths.map((p) => `  ${p}`).join('\n')}`,
                    );
                }
                return relativePaths.join('\n');
            }

            case 'readWorkspaceFile': {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) return 'No workspace folder open.';

                const absolutePath = path.join(workspaceFolders[0].uri.fsPath, input.filePath);

                // Ensure the path stays within the workspace
                if (!absolutePath.startsWith(workspaceFolders[0].uri.fsPath)) {
                    return 'Error: File path must be within the workspace.';
                }

                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
                    const text = Buffer.from(content).toString('utf-8');
                    return text.length > MAX_FILE_CHARS ? text.slice(0, MAX_FILE_CHARS) + '\n... (truncated)' : text;
                } catch {
                    return `Error: Could not read file "${input.filePath}".`;
                }
            }

            default:
                return `Unknown tool: ${toolCall.name}`;
        }
    };
}

/**
 * Builds a fileName → absolutePath lookup map from a list of file paths.
 */
export function buildFileMap(filePaths: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const filePath of filePaths) {
        map.set(path.basename(filePath), filePath);
    }
    return map;
}
