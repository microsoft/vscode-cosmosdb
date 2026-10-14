/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseCodeEvidencedTables } from '../helpers/markdownUtils';
import { createToolExecutor, getRegisteredChatTools } from '../tools/migrationTools';
import { gatherWorkspaceContext } from './phase1Discovery';

vi.mock('../helpers/aiHelpers', () => ({}));
vi.mock('../prompts', () => ({}));
vi.mock('@microsoft/vscode-azext-utils', () => ({ callWithTelemetryAndErrorHandling: vi.fn() }));
vi.mock('../../../extensionVariables', () => ({
    ext: { outputChannel: { debug: vi.fn(), appendLog: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));
vi.mock('vscode', async (importOriginal) => {
    const original = await importOriginal<typeof vscode>();
    return {
        ...original,
        Uri: { file: (fsPath: string) => ({ fsPath }) },
        RelativePattern: class {
            constructor(
                public base: string,
                public pattern: string,
            ) {}
        },
        workspace: {
            ...original.workspace,
            get workspaceFolders() {
                return [];
            },
            findFiles: vi.fn(),
            fs: { readFile: vi.fn(), stat: vi.fn() },
        },
        lm: {
            tools: [{ name: 'copilot_searchCodebase', description: 'Search', inputSchema: {} }],
            invokeTool: vi.fn(),
        },
    };
});

describe('project-scoped discovery', () => {
    let directory: string;
    let projectRoot: string;
    let siblingRoot: string;
    let projectFile: vscode.Uri;
    let siblingFile: vscode.Uri;

    beforeEach(async () => {
        vi.clearAllMocks();
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-discovery-scope-'));
        projectRoot = path.join(directory, 'app');
        siblingRoot = path.join(directory, 'other');
        for (const root of [projectRoot, siblingRoot]) {
            await fs.mkdir(root);
            await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: path.basename(root) }));
        }
        projectFile = vscode.Uri.file(path.join(projectRoot, 'package.json'));
        siblingFile = vscode.Uri.file(path.join(siblingRoot, 'package.json'));
        vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue(
            [siblingRoot, projectRoot].map((root, index) => ({ uri: vscode.Uri.file(root), name: root, index })),
        );
        vi.mocked(vscode.workspace.findFiles).mockResolvedValue([siblingFile, projectFile]);
        vi.mocked(vscode.workspace.fs.readFile).mockImplementation((uri) => fs.readFile(uri.fsPath));
        vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({ type: 1, ctime: 0, mtime: 0, size: 14 });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await fs.rm(directory, { recursive: true, force: true });
    });

    it('gathers manifests only from the selected project regardless of folder order', async () => {
        const context = await gatherWorkspaceContext(projectRoot);
        expect(context).toContain('{"name":"app"}');
        expect(context).not.toContain('{"name":"other"}');
        for (const [pattern] of vi.mocked(vscode.workspace.findFiles).mock.calls) {
            expect(pattern).toBeInstanceOf(vscode.RelativePattern);
            expect(pattern).toMatchObject({ base: projectRoot });
        }
        expect(vscode.workspace.fs.readFile).not.toHaveBeenCalledWith(siblingFile);
    });

    it('lists and reads only selected-project source files', async () => {
        const execute = createToolExecutor({ workspacePath: projectRoot });
        const listing = await execute({ callId: 'list', name: 'listWorkspaceFiles', input: {} });
        expect(listing).toContain(projectFile.fsPath);
        expect(listing).not.toContain(siblingFile.fsPath);
        const selected = await execute({
            callId: 'read',
            name: 'readWorkspaceFile',
            input: { filePath: projectFile.fsPath },
        });
        expect(selected).toBe('{"name":"app"}');
        const sibling = await execute({
            callId: 'read-other',
            name: 'readWorkspaceFile',
            input: { filePath: siblingFile.fsPath },
        });
        expect(sibling).toContain('Error:');
        expect(vscode.workspace.fs.readFile).not.toHaveBeenCalledWith(siblingFile);
    });

    it('blocks symlink escapes and host-wide search tools in scoped runs', async () => {
        await fs.symlink(siblingRoot, path.join(projectRoot, 'external'), 'junction');
        const execute = createToolExecutor({ workspacePath: projectRoot });
        const escaped = await execute({
            callId: 'escape',
            name: 'readWorkspaceFile',
            input: { filePath: path.join(projectRoot, 'external/package.json') },
        });
        expect(escaped).toContain('Error:');
        expect(getRegisteredChatTools(new Set(), projectRoot)).toEqual([]);
        const search = await execute({
            callId: 'search',
            name: 'copilot_searchCodebase',
            input: { query: 'database access' },
        });
        expect(search).toContain('Error:');
        expect(vscode.lm.invokeTool).not.toHaveBeenCalled();
        expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
    });

    it('retains registered tools when the project is the sole workspace root', () => {
        vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
            { uri: vscode.Uri.file(projectRoot), name: 'app', index: 0 },
        ]);
        expect(getRegisteredChatTools(new Set(), projectRoot).map((tool) => tool.name)).toContain(
            'copilot_searchCodebase',
        );
        expect(getRegisteredChatTools(new Set(['copilot_searchCodebase']), projectRoot)).toEqual([]);
    });
});

describe('parseCodeEvidencedTables', () => {
    it('returns empty array for empty input', () => {
        expect(parseCodeEvidencedTables('')).toEqual([]);
    });

    it('returns empty array when no table rows have markdown links', () => {
        const md = `# Access Patterns

## Read Patterns

| #    | Pattern Name        | Tables / Entities | Filter / Lookup Fields | Frequency (TPS) | Latency Requirement | Notes              |
|-----:|---------------------|-------------------|------------------------|----------------:|---------------------|--------------------|
| R001 | Get order by ID     | Orders            | OrderId                |             200 | < 10 ms             | point read         |
| R002 | List by customer    | Orders, Customers | CustomerId             |             150 | < 50 ms             | paginated          |`;

        expect(parseCodeEvidencedTables(md)).toEqual([]);
    });

    it('extracts tables from rows with markdown links', () => {
        const md = `| #    | Pattern Name        | Tables / Entities      | Filter       | TPS | Latency  | Notes                                           |
|-----:|---------------------|------------------------|--------------|----:|----------|-------------------------------------------------|
| R001 | Get order by ID     | Orders, OrderItems     | OrderId      | 200 | < 10 ms  | [OrderRepo.ts](../../src/repos/OrderRepo.ts)    |
| R002 | List customers      | Customers              | Name         | 100 | < 50 ms  | no code ref                                     |`;

        expect(parseCodeEvidencedTables(md)).toEqual(['Orders', 'OrderItems']);
    });

    it('deduplicates table names across multiple rows', () => {
        const md = `| R001 | Get order       | Orders, OrderItems | OrderId    | 200 | < 10 ms | [Repo.ts](../../src/Repo.ts)       |
| R002 | Search orders   | Orders             | Status     | 150 | < 50 ms | [Search.ts](../../src/Search.ts)   |
| W001 | Insert order    | Orders, OrderItems | OrderId    | 100 | < 100ms | [Writer.ts](../../src/Writer.ts)   |`;

        const result = parseCodeEvidencedTables(md);
        expect(result).toContain('Orders');
        expect(result).toContain('OrderItems');
        expect(result.filter((t) => t === 'Orders')).toHaveLength(1);
    });

    it('ignores header separator rows', () => {
        const md = `| # | Name | Tables | Notes |
|---|------|--------|-------|
| R001 | Get order | Orders | [Repo.ts](src/Repo.ts) |`;

        expect(parseCodeEvidencedTables(md)).toEqual(['Orders']);
    });

    it('ignores rows without valid pattern IDs', () => {
        const md = `| total | Summary | Orders, Products | [link](file.ts) |`;

        expect(parseCodeEvidencedTables(md)).toEqual([]);
    });

    it('handles write patterns', () => {
        const md = `| W001 | Insert order | Orders, OrderItems | [Writer.ts](../../src/Writer.ts) |
| W002 | Update stock | Products | no link |`;

        expect(parseCodeEvidencedTables(md)).toEqual(['Orders', 'OrderItems']);
    });

    it('handles markdown links anywhere in the row', () => {
        const md = `| R001 | [Get order](docs/patterns.md) | Orders | [Repo.ts](src/Repo.ts) |`;

        expect(parseCodeEvidencedTables(md)).toEqual(['Orders']);
    });

    it('trims whitespace from table names', () => {
        const md = `| R001 | Get order | Orders ,  OrderItems , Customers | OrderId | 200 | < 10ms | [Repo.ts](src/Repo.ts) |`;

        const result = parseCodeEvidencedTables(md);
        expect(result).toEqual(['Orders', 'OrderItems', 'Customers']);
    });
});
