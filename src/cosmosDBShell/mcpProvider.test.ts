/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import * as http from 'http';
import { createServer, type AddressInfo } from 'net';
import { ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import * as vscode from 'vscode';
import { MCP_SERVER_NAME, SETTING_MCP_PORT } from './constants';
import { resolveCosmosDBShellCommand } from './cosmosDBShellCommandResolver';
import { getCosmosDBShellMcpEndpoint } from './cosmosDBShellMcpEndpoint';
import { registerMcpServer } from './mcpProvider';
import { isMcpShellServer } from './mcpShellProbe';

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

async function stopShellProcess(shell: ChildProcess): Promise<void> {
    if (!shell.pid || shell.exitCode !== null || shell.signalCode !== null) {
        return;
    }
    if (!shell.stdin) {
        throw new Error('The owned Shell process has no stdin pipe for the exit command.');
    }

    const exited = once(shell, 'exit', { signal: AbortSignal.timeout(5000) });
    const forceKill = setTimeout(() => {
        console.warn(
            'Shell did not exit within 2 seconds of the exit command; stopping the owned test process with SIGKILL.',
        );
        shell.kill('SIGKILL');
    }, 2000);
    try {
        shell.stdin.end('exit\n');
        await exited;
    } finally {
        clearTimeout(forceKill);
    }
}

describe('Shell test process cleanup', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    const childProcess = (): { child: ChildProcess; input: PassThrough } => {
        const child = new ChildProcess();
        const input = new PassThrough();
        child.stdin = input;
        Object.defineProperty(child, 'pid', { value: 12345 });
        return { child, input };
    };

    it('sends exit through stdin without killing a process that shuts down normally', async () => {
        const { child, input } = childProcess();
        const end = vi.spyOn(input, 'end');
        const kill = vi.spyOn(child, 'kill').mockReturnValue(true);
        input.on('data', () => {
            queueMicrotask(() => child.emit('exit', 0, null));
        });

        await stopShellProcess(child);
        await vi.advanceTimersByTimeAsync(5000);

        expect(end).toHaveBeenCalledWith('exit\n');
        expect(kill).not.toHaveBeenCalled();
        expect(child.listenerCount('exit')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('force-kills a process that ignores exit at the two-second deadline', async () => {
        const { child, input } = childProcess();
        const end = vi.spyOn(input, 'end');
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const kill = vi.spyOn(child, 'kill').mockImplementation((signal) => {
            if (signal === 'SIGKILL') {
                queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
            }
            return true;
        });

        const stopped = stopShellProcess(child);
        await vi.advanceTimersByTimeAsync(1999);
        expect(end).toHaveBeenCalledWith('exit\n');
        expect(kill).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await stopped;

        expect(kill.mock.calls).toEqual([['SIGKILL']]);
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('SIGKILL'));
        expect(child.listenerCount('exit')).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});

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

    describe.runIf(process.env.COSMOSDB_SHELL_MCP_INTEGRATION === '1' || process.env.COSMOSDB_SHELL_MCP_TEST_PORT)(
        'live Shell MCP integration',
        () => {
            let port: string;
            let shell: ChildProcess | undefined;
            let output = '';
            let startupError: Error | undefined;
            let client: Client;
            let transport: StreamableHTTPClientTransport;

            beforeAll(async () => {
                if (process.env.COSMOSDB_SHELL_MCP_TEST_PORT) {
                    port = process.env.COSMOSDB_SHELL_MCP_TEST_PORT;
                    return;
                }

                const listener = createServer();
                listener.listen(0, '127.0.0.1');
                await once(listener, 'listening');
                port = (listener.address() as AddressInfo).port.toString();
                await new Promise<void>((resolve, reject) =>
                    listener.close((error) => (error ? reject(error) : resolve())),
                );

                const command = resolveCosmosDBShellCommand(process.env.COSMOSDB_SHELL_MCP_TEST_PATH);
                shell = spawn(command, ['--mcp', port, '--quiet'], {
                    stdio: 'pipe',
                    windowsHide: true,
                });
                shell.on('error', (error) => {
                    startupError = error;
                });
                shell.stdout?.on('data', (chunk: Buffer) => {
                    output += chunk.toString();
                });
                shell.stderr?.on('data', (chunk: Buffer) => {
                    output += chunk.toString();
                });

                const startupToken = new vscode.CancellationTokenSource();
                try {
                    await vi.waitFor(
                        async () => {
                            if (startupError || shell?.exitCode !== null || shell?.signalCode !== null) {
                                throw new Error(
                                    `Shell failed to start: ${startupError?.message ?? shell?.exitCode}\n${output}`,
                                );
                            }
                            const ready = await isMcpShellServer(
                                port,
                                startupToken.token,
                                (message) => {
                                    output += `${message}\n`;
                                },
                                1000,
                            );
                            if (!ready) {
                                throw new Error(`Shell MCP did not become ready:\n${output}`);
                            }
                        },
                        { timeout: 30_000, interval: 250 },
                    );
                } finally {
                    startupToken.dispose();
                }
            }, 35_000);

            afterAll(async () => {
                if (shell) {
                    await stopShellProcess(shell);
                }
            });

            beforeEach(async () => {
                mocks.getSetting.mockImplementation((key: string) => (key === SETTING_MCP_PORT ? Number(port) : true));
                transport = new StreamableHTTPClientTransport(new URL(getCosmosDBShellMcpEndpoint(port)));
                client = new Client({ name: 'cosmosdb-shell-regression-test', version: '1.0.0' });
                await client.connect(transport, { timeout: 3000 });
            });

            afterEach(async () => {
                try {
                    // An owned Shell process is stopped after the suite, releasing all its server sessions.
                    if (process.env.COSMOSDB_SHELL_MCP_TEST_PORT && transport.sessionId) {
                        await transport.terminateSession();
                    }
                } finally {
                    await client.close();
                }
            });

            it('reuses a live Shell through the registered resolver after an MCP handshake', async () => {
                const server = definition(port);
                const resolved = await provider.resolveMcpServerDefinition?.(server, tokenSource.token);
                expect(resolved).toBe(server);
                expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
                expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
                expect(client.getServerVersion()?.name).toBe('CosmosDBShell');
                expect(client.getServerVersion()?.version).toEqual(expect.any(String));
                await client.ping();
            });

            it('discovers Shell tools and their input schemas', async () => {
                const tools = [];
                let cursor: string | undefined;
                do {
                    const result = await client.listTools({ cursor });
                    tools.push(...result.tools);
                    cursor = result.nextCursor;
                } while (cursor);
                expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['help', 'version', 'echo']));
                for (const tool of tools) {
                    expect(tool.inputSchema.type).toBe('object');
                }
            });

            it('executes version with a nonempty text result', async () => {
                const result = await client.callTool({ name: 'version', arguments: {} });
                expect(result).not.toHaveProperty('isError', true);
                expect(result.content).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({ type: 'text', text: expect.stringMatching(/\S/) }),
                    ]),
                );
                expect(result.structuredContent).toEqual(
                    expect.objectContaining({
                        result: expect.objectContaining({
                            version: expect.stringMatching(/^\d+\.\d+\.\d+(?:[-+].+)?$/),
                            mcpEnabled: true,
                            mcpPort: Number(port),
                            mcpStatus: 'on',
                        }),
                    }),
                );
            });
        },
    );
});
