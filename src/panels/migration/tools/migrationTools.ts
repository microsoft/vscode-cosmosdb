/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { extractStructuralDDL } from '../../../utils/ddlExtractor';
import { loadSkillSupplementaryFile } from '../bestPractices';

// ─── Tool Definitions ────────────────────────────────────────────────

const SCHEMA_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'listSchemaFiles',
        description:
            'Lists all schema DDL files available in the migration project. Returns absolute file paths with sizes in bytes (e.g. "/workspace/schema.sql (4096 bytes)"), one per line. Use file sizes to gauge the cost before reading.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'readSchemaFile',
        description:
            'Reads the content of a single schema file. ' +
            'For SQL/DDL files, structural statements are extracted (CREATE TABLE, ALTER TABLE, CREATE INDEX, CREATE VIEW, CREATE SEQUENCE, CREATE TYPE, CREATE DOMAIN) while data operations and comments are stripped. ' +
            'If no structural DDL is found, the raw file content is returned. ' +
            'For CSV files, only the header and first data row are returned. ' +
            'All other formats are returned as-is.',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: {
                    type: 'string',
                    description: 'The absolute file path to read (as returned by listSchemaFiles).',
                },
            },
            required: ['fileName'],
        },
    },
];

const ACCESS_PATTERN_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'listAccessPatternFiles',
        description:
            'Lists user-provided access pattern documentation files with sizes in bytes (e.g. "/workspace/access-patterns.md (2048 bytes)"), one per line. Returns absolute file paths. These contain known access patterns, query logs, or usage notes. Use file sizes to gauge the cost before reading.',
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
                    description: 'The absolute file path to read (as returned by listAccessPatternFiles).',
                },
            },
            required: ['fileName'],
        },
    },
];

// Kept for future use; volumetrics.md is currently embedded directly in the prompt
// rather than being loaded via tools. Exported to avoid noUnusedLocals error.
export const VOLUMETRIC_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'listVolumetricFiles',
        description:
            'Lists user-provided volumetric data files (query logs, AWR reports, usage statistics) with sizes in bytes (e.g. "/workspace/awr-report.txt (102400 bytes)"), one per line. Returns absolute file paths. These contain quantitative data about database usage. Use file sizes to gauge the cost before reading.',
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
                    description: 'The absolute file path to read (as returned by listVolumetricFiles).',
                },
            },
            required: ['fileName'],
        },
    },
];

const WORKSPACE_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'listWorkspaceFiles',
        description:
            'Lists source code files in the workspace that may contain database access patterns, queries, or data layer code. ' +
            'Returns absolute file paths with sizes in bytes (e.g. "/workspace/src/repo/OrderRepository.cs (3200 bytes)"), one per line. ' +
            'Use file sizes to prioritize which files to read. Use this to discover application code that interacts with the database.',
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
            '(queries, ORM mappings, repository patterns, stored procedure calls, etc.). ' +
            'Supports optional startLine/endLine to read a specific chunk of lines (1-based, inclusive). ' +
            'When reading the whole file, content is truncated if it exceeds the token limit.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'The absolute file path to read (as returned by listWorkspaceFiles).',
                },
                startLine: {
                    type: 'number',
                    description:
                        'Optional 1-based start line number. If provided with endLine, only that range of lines is returned.',
                },
                endLine: {
                    type: 'number',
                    description: 'Optional 1-based end line number (inclusive). Must be >= startLine.',
                },
            },
            required: ['filePath'],
        },
    },
];

/** Returns workspace tools (listWorkspaceFiles + readWorkspaceFile). */
export function getWorkspaceTools(): vscode.LanguageModelChatTool[] {
    return [...WORKSPACE_TOOLS];
}

// ─── Best Practice Rule Tools ────────────────────────────────────────

const BEST_PRACTICE_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'loadSkillSupplementaryFile',
        description:
            'Reads a supplementary file (e.g. a detailed rule) that belongs to a skill. ' +
            'The SKILL.md overview already lists available files with relative paths — use those paths as the supplementaryFile parameter.',
        inputSchema: {
            type: 'object',
            properties: {
                skillPath: {
                    type: 'string',
                    description:
                        'Extension-relative path to the SKILL.md (e.g. "skills/cosmosdb-best-practices/SKILL.md").',
                },
                supplementaryFile: {
                    type: 'string',
                    description: 'Path relative to the skill folder (e.g. "rules/partition-high-cardinality.md").',
                },
            },
            required: ['skillPath', 'supplementaryFile'],
        },
    },
];

/** Returns best practice skill tools (loadSkillSupplementaryFile). */
export function getBestPracticeTools(): vscode.LanguageModelChatTool[] {
    return [...BEST_PRACTICE_TOOLS];
}

/** Returns all discovery tools (schema + access patterns + workspace).
 *  Note: VOLUMETRIC_TOOLS are intentionally excluded — volumetrics.md is
 *  embedded directly in the prompt instead of being loaded via tools. */
export function getAllDiscoveryTools(): vscode.LanguageModelChatTool[] {
    return [...SCHEMA_TOOLS, ...ACCESS_PATTERN_TOOLS, ...WORKSPACE_TOOLS];
}

const ALLOWED_CHAT_TOOLS: ReadonlySet<string> = new Set([
    //'copilot_readProjectStructure', // might be useful for project analysis but probably too generic?
    'copilot_searchCodebase', // Performs a semantic/natural language search across the codebase using Copilot's index, returning relevant code snippets.
    //'copilot_findFiles', // our list*Files tools are more cost-effective and better tailored to migration needs, so we exclude the more general findFiles/findTextInFiles
    'copilot_findTextInFiles', // Searches for an exact string or regex in workspace files, returning matching lines with file/line context.
    //'copilot_readFile', // our read*File tools cap at 10K Tokens and have custom logic for extracting structural DDL and previewing CSVs, so we exclude the more general readFile tool
]);

/**
 * Returns a curated set of VS Code chat tools registered via `vscode.lm.tools`.
 * Only tools in the {@link ALLOWED_CHAT_TOOLS} allowlist are included, and any
 * whose names collide with the provided set of custom tool names are excluded.
 */
export function getRegisteredChatTools(excludeNames: ReadonlySet<string>): vscode.LanguageModelChatTool[] {
    return vscode.lm.tools
        .filter((t) => ALLOWED_CHAT_TOOLS.has(t.name) && !excludeNames.has(t.name))
        .map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        }));
}

/**
 * Serializes a `LanguageModelToolResult` into a plain string by joining all
 * text parts. Non-text parts are JSON-stringified as a fallback.
 */
export function serializeToolResult(result: vscode.LanguageModelToolResult): string {
    return result.content
        .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : JSON.stringify(part)))
        .join('');
}

// ─── Tool Executor ───────────────────────────────────────────────────

export interface ToolFileLists {
    schemaFiles?: string[];
    accessPatternFiles?: string[];
    volumetricFiles?: string[];
}

const BASE_WORKSPACE_EXCLUDES = ['**/node_modules/**', '**/.cosmosdb-migration/**', '**/.git/**'];

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

export function getWorkspaceFileExclude(language?: string, frameworks?: string[]): string {
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

export const DEFAULT_SOURCE_PATTERN = '**/*.{ts,js,cs,java,py,go,rb,rs,php,kt,scala,sql}';

// Re-exported from shared `utils/aiUtils` to avoid churn for existing migration callers.
import { CHARS_PER_TOKEN, estimateTokens, MAX_FILE_TOKENS } from '../../../utils/aiUtils';
export { CHARS_PER_TOKEN, estimateTokens, MAX_FILE_TOKENS };

/**
 * Creates a unified tool executor function that handles all migration AI tools.
 * Pass in file maps for schema/access-pattern/volumetric tools; workspace tools
 * always work against the current VS Code workspace.
 *
 * @param fileMaps Optional lookup maps for file-based tools.
 * @param logPrefix Optional prefix for output channel logging (e.g. "[Discovery]").
 */
export function createToolExecutor(
    fileLists: ToolFileLists = {},
    logPrefix?: string,
    languageContext?: { language?: string; frameworks?: string[] },
    token?: vscode.CancellationToken,
): (toolCall: vscode.LanguageModelToolCallPart) => Promise<string> {
    const { schemaFiles, accessPatternFiles, volumetricFiles } = fileLists;
    const workspaceFileExclude = getWorkspaceFileExclude(languageContext?.language, languageContext?.frameworks);

    return async (toolCall: vscode.LanguageModelToolCallPart): Promise<string> => {
        const input = toolCall.input as Record<string, string>;
        const tag = logPrefix ?? '[Migration]';

        if (logPrefix) {
            ext.outputChannel.appendLog(
                `${logPrefix} Tool: ${toolCall.name}, params: ${JSON.stringify(toolCall.input)}`,
            );
        } else {
            ext.outputChannel.debug(`${tag} Tool: ${toolCall.name}, params: ${JSON.stringify(toolCall.input)}`);
        }

        const toolStartTime = Date.now();
        let result: string;

        const finishToolLog = (res: string): string => {
            const elapsed = Date.now() - toolStartTime;
            const preview = res.length > 200 ? res.slice(0, 200) + '…' : res;
            ext.outputChannel.debug(
                `${tag} Tool ${toolCall.name} result: ${res.length} chars, ${elapsed}ms — ${preview}`,
            );
            return res;
        };

        try {
            result = await executeToolCallInner(toolCall, input);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            ext.outputChannel.debug(`${tag} Tool ${toolCall.name} threw: ${message} (${Date.now() - toolStartTime}ms)`);
            throw e;
        }

        return finishToolLog(result);
    };

    async function executeToolCallInner(
        toolCall: vscode.LanguageModelToolCallPart,
        input: Record<string, string>,
    ): Promise<string> {
        switch (toolCall.name) {
            // ── Schema tools ──
            case 'listSchemaFiles': {
                if (!schemaFiles || schemaFiles.length === 0) return 'No schema files available.';
                const entries = await Promise.all(
                    schemaFiles.map(async (absPath) => {
                        try {
                            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
                            return `${absPath} (${stat.size} bytes)`;
                        } catch {
                            return `${absPath} (unknown size)`;
                        }
                    }),
                );
                return entries.join('\n');
            }

            case 'readSchemaFile': {
                if (!schemaFiles || schemaFiles.length === 0) return 'No schema files available.';
                const absolutePath =
                    schemaFiles.find((f) => f === input.fileName) ??
                    schemaFiles.find((f) => path.basename(f) === path.basename(input.fileName));
                if (!absolutePath) {
                    return `Error: File "${input.fileName}" not found. Use listSchemaFiles to see available files.`;
                }
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
                    const rawText = Buffer.from(content).toString('utf-8');
                    const fileExt = path.extname(absolutePath).toLowerCase();
                    if (fileExt === '.sql' || fileExt === '.ddl') {
                        const extracted = extractStructuralDDL(rawText);
                        return extracted || rawText;
                    }
                    if (fileExt === '.csv') return rawText.split('\n').slice(0, 2).join('\n');
                    return rawText;
                } catch {
                    return `Error: Could not read file "${input.fileName}".`;
                }
            }

            // ── Access pattern tools ──
            case 'listAccessPatternFiles': {
                if (!accessPatternFiles || accessPatternFiles.length === 0)
                    return 'No user-provided access pattern files available.';
                const entries = await Promise.all(
                    accessPatternFiles.map(async (absPath) => {
                        try {
                            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
                            return `${absPath} (${stat.size} bytes)`;
                        } catch {
                            return `${absPath} (unknown size)`;
                        }
                    }),
                );
                return entries.join('\n');
            }

            case 'readAccessPatternFile': {
                if (!accessPatternFiles || accessPatternFiles.length === 0) return 'No access pattern files available.';
                const absolutePath =
                    accessPatternFiles.find((f) => f === input.fileName) ??
                    accessPatternFiles.find((f) => path.basename(f) === path.basename(input.fileName));
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
            case 'listVolumetricFiles': {
                if (!volumetricFiles || volumetricFiles.length === 0) return 'No volumetric data files available.';
                const entries = await Promise.all(
                    volumetricFiles.map(async (absPath) => {
                        try {
                            const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
                            return `${absPath} (${stat.size} bytes)`;
                        } catch {
                            return `${absPath} (unknown size)`;
                        }
                    }),
                );
                return entries.join('\n');
            }

            case 'readVolumetricFile': {
                if (!volumetricFiles || volumetricFiles.length === 0) return 'No volumetric files available.';
                const absolutePath =
                    volumetricFiles.find((f) => f === input.fileName) ??
                    volumetricFiles.find((f) => path.basename(f) === path.basename(input.fileName));
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
                const files = await vscode.workspace.findFiles(pattern, workspaceFileExclude);

                if (files.length === 0) {
                    if (logPrefix) {
                        ext.outputChannel.appendLog(`${logPrefix} listWorkspaceFiles("${pattern}"): 0 files found`);
                    }
                    return `No files found matching pattern "${pattern}".`;
                }

                const fileEntries = await Promise.all(
                    files.map(async (f) => {
                        const absolutePath = f.fsPath;
                        try {
                            const stat = await vscode.workspace.fs.stat(f);
                            return { absolutePath, size: stat.size };
                        } catch {
                            return { absolutePath, size: -1 };
                        }
                    }),
                );
                fileEntries.sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));
                if (logPrefix) {
                    ext.outputChannel.appendLog(
                        `${logPrefix} listWorkspaceFiles("${pattern}"): ${fileEntries.length} files\n${fileEntries.map((e) => `  ${e.absolutePath}`).join('\n')}`,
                    );
                }
                return fileEntries
                    .map((e) =>
                        e.size >= 0 ? `${e.absolutePath} (${e.size} bytes)` : `${e.absolutePath} (unknown size)`,
                    )
                    .join('\n');
            }

            case 'readWorkspaceFile': {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) return 'No workspace folder open.';

                // Reject non-absolute paths to avoid resolving against the extension host CWD.
                if (!input.filePath || !path.isAbsolute(input.filePath)) {
                    return 'Error: File path must be an absolute path inside the workspace.';
                }

                const absolutePath = path.normalize(input.filePath);

                // Ensure the resolved path stays inside one of the workspace folders.
                // Use path.relative so that "/ws/foo-evil/x" is not accepted when the
                // workspace is "/ws/foo" (a naive startsWith check would allow it).
                const isWithinWorkspace = workspaceFolders.some((folder) => {
                    const folderPath = path.normalize(folder.uri.fsPath);
                    if (absolutePath === folderPath) return true;
                    const rel = path.relative(folderPath, absolutePath);
                    return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
                });
                if (!isWithinWorkspace) {
                    return 'Error: File path must be within the workspace.';
                }

                const startLine = input.startLine ? Number(input.startLine) : undefined;
                const endLine = input.endLine ? Number(input.endLine) : undefined;
                const isChunked = startLine !== undefined && endLine !== undefined;

                if (isChunked && (startLine < 1 || endLine < startLine)) {
                    return 'Error: startLine must be >= 1 and endLine must be >= startLine.';
                }

                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
                    const text = Buffer.from(content).toString('utf-8');

                    if (isChunked) {
                        const lines = text.split('\n');
                        const totalLines = lines.length;
                        const chunk = lines.slice(startLine - 1, endLine).join('\n');
                        return `[Lines ${startLine}-${Math.min(endLine, totalLines)} of ${totalLines}]\n${chunk}`;
                    }

                    // Token cap only applies when reading the whole file
                    return estimateTokens(text) > MAX_FILE_TOKENS
                        ? text.slice(0, MAX_FILE_TOKENS * CHARS_PER_TOKEN) + '\n... (truncated)'
                        : text;
                } catch {
                    return `Error: Could not read file "${input.filePath}".`;
                }
            }

            // ── Best practice rule tools ──
            case 'loadSkillSupplementaryFile': {
                return loadSkillSupplementaryFile(input.skillPath, input.supplementaryFile);
            }

            default: {
                // Fall back to VS Code registered chat tools
                try {
                    const vsCodeResult = await vscode.lm.invokeTool(
                        toolCall.name,
                        { input: toolCall.input, toolInvocationToken: undefined },
                        token ?? new vscode.CancellationTokenSource().token,
                    );
                    return serializeToolResult(vsCodeResult);
                } catch (e) {
                    const message = e instanceof Error ? e.message : String(e);
                    if (logPrefix) {
                        ext.outputChannel.error(`${logPrefix} VS Code chat tool "${toolCall.name}" failed: ${message}`);
                    }
                    return `Error invoking tool "${toolCall.name}": ${message}`;
                }
            }
        }
    }
}
