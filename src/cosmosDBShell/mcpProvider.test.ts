/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as http from 'http';
import { type AddressInfo } from 'net';
import * as vscode from 'vscode';
import { MCP_SERVER_NAME, SETTING_MCP_PORT } from './constants';
import { getCosmosDBShellMcpEndpoint } from './cosmosDBShellMcpEndpoint';
import { registerMcpServer } from './mcpProvider';

const mocks = vi.hoisted(() => ({
    getSetting: vi.fn(),
    appendLine: vi.fn(),
}));

vi.mock('../extensionVariables', () => ({
    ext: { outputChannel: { appendLine: mocks.appendLine } },
}));
vi.mock('../services/SettingsService', () => ({
    SettingsService: { getSetting: mocks.getSetting },
}));
vi.mock('./shellSupportCache', () => ({
    isCosmosDBShellInstalled: () => true,
    invalidateCosmosDBShellSupportCache: vi.fn(),
}));

describe('Shell MCP provider resolution', () => {
    let provider: vscode.McpServerDefinitionProvider;
    let tokenSource: vscode.CancellationTokenSource;
    let subscriptions: vscode.Disposable[];

    beforeEach(() => {
        vi.clearAllMocks();
        tokenSource = new vscode.CancellationTokenSource();
        subscriptions = [];
        vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({ dispose: vi.fn() });
        Object.assign(vscode.lm, {
            registerMcpServerDefinitionProvider: vi.fn(
                (_id: string, registeredProvider: vscode.McpServerDefinitionProvider) => {
                    provider = registeredProvider;
                    return { dispose: vi.fn() };
                },
            ),
        });
        registerMcpServer({ subscriptions } as vscode.ExtensionContext);
    });

    afterEach(() => {
        tokenSource.dispose();
        subscriptions.forEach((subscription) => subscription.dispose());
    });

    const definition = (port: string): vscode.McpHttpServerDefinition => ({
        label: MCP_SERVER_NAME,
        uri: vscode.Uri.parse(getCosmosDBShellMcpEndpoint(port)),
        headers: { API_VERSION: '1.0.0' },
    });

    it('rejects an unrelated occupied HTTP port with a verification diagnostic', async () => {
        const server = http.createServer((_req, res) => res.writeHead(200).end('unrelated service'));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as AddressInfo).port.toString();
        mocks.getSetting.mockReturnValue(Number(port));
        try {
            await expect(provider.resolveMcpServerDefinition?.(definition(port), tokenSource.token)).rejects.toThrow(
                'could not be verified',
            );
            expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
                expect.stringContaining('could not be verified'),
                'Settings',
            );
            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });

    it.runIf(process.env.COSMOSDB_SHELL_MCP_TEST_PORT)(
        'reuses a live Shell through the registered resolver and executes an MCP tool',
        async () => {
            const port = process.env.COSMOSDB_SHELL_MCP_TEST_PORT!;
            mocks.getSetting.mockImplementation((key: string) => (key === SETTING_MCP_PORT ? Number(port) : true));
            const server = definition(port);
            const resolved = await provider.resolveMcpServerDefinition?.(server, tokenSource.token);
            expect(resolved).toBe(server);
            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
            expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();

            const transport = new StreamableHTTPClientTransport(new URL(server.uri.toString()));
            const client = new Client({ name: 'cosmosdb-shell-regression-test', version: '1.0.0' });
            try {
                await client.connect(transport, { timeout: 3000 });
                expect(client.getServerVersion()?.name).toBe('CosmosDBShell');
                const result = await client.callTool({ name: 'help', arguments: { command: 'version', plain: true } });
                expect(result.isError).not.toBe(true);
                expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]));
            } finally {
                try {
                    await transport.terminateSession();
                } finally {
                    await client.close();
                }
            }
        },
    );
});
