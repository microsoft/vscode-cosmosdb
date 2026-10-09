/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import { type AddressInfo } from 'net';
import * as vscode from 'vscode';
import { isMcpShellServer } from './mcpShellProbe';

describe('Shell MCP identity probe', () => {
    let server: http.Server;
    let port: string;
    let tokenSource: vscode.CancellationTokenSource;
    const log = vi.fn();

    const startServer = async (handler: http.RequestListener): Promise<void> => {
        server = http.createServer(handler);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port.toString();
    };

    const readMessage = async (req: http.IncomingMessage): Promise<{ id?: number; method: string }> => {
        let body = '';
        for await (const chunk of req) {
            body += String(chunk);
        }
        return JSON.parse(body);
    };

    const initializeResult = (id: number | undefined, name = 'CosmosDBShell') => ({
        jsonrpc: '2.0',
        id,
        result: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            serverInfo: { name, version: '1.0.0' },
        },
    });

    beforeEach(() => {
        tokenSource = new vscode.CancellationTokenSource();
        log.mockClear();
    });

    afterEach(async () => {
        tokenSource.dispose();
        if (server) {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    it.each([
        { contentType: 'application/json', jsonResponse: true },
        { contentType: 'application/json; charset=utf-8', jsonResponse: true },
        { contentType: 'Application/JSON ; charset=utf-8', jsonResponse: true },
        { contentType: 'text/event-stream', jsonResponse: false },
        { contentType: 'text/event-stream; charset=utf-8', jsonResponse: false },
        { contentType: 'Text/Event-Stream ; charset=utf-8', jsonResponse: false },
    ])(
        'recognizes root initialization with $contentType, without depending on /sse, and deletes its session',
        async ({ contentType, jsonResponse }) => {
            const paths: string[] = [];
            const deleted = vi.fn();
            const initialized = vi.fn();
            const notified = vi.fn();
            await startServer((req, res) => {
                paths.push(`${req.method} ${req.url}`);
                if (req.url === '/sse' || req.method === 'GET') {
                    res.writeHead(404).end();
                } else if (req.method === 'DELETE') {
                    deleted(req.headers['mcp-session-id'], req.headers['mcp-protocol-version']);
                    res.writeHead(200).end();
                } else {
                    void readMessage(req).then((message) => {
                        if (message.method === 'initialize') {
                            initialized(message, req.headers);
                            res.writeHead(200, {
                                'Content-Type': contentType,
                                'Mcp-Session-Id': 'probe-session',
                            });
                            const result = JSON.stringify(initializeResult(message.id));
                            if (jsonResponse) {
                                res.end(result);
                            } else {
                                // Split the event across chunks, and keep the stream open after the response.
                                res.write('event: message\r\ndata: ');
                                res.write(`${result}\r\n\r\n`);
                            }
                        } else {
                            notified(message, req.headers);
                            res.writeHead(202).end();
                        }
                    });
                }
            });

            expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(true);
            expect(paths).not.toContain('GET /sse');
            expect(initialized).toHaveBeenCalledWith(
                {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2025-11-25',
                        capabilities: {},
                        clientInfo: { name: 'cosmosdb-shell-identity-probe', version: '1.0.0' },
                    },
                },
                expect.objectContaining({
                    'content-type': 'application/json',
                    accept: 'application/json, text/event-stream',
                }),
            );
            expect(notified).toHaveBeenCalledWith(
                { jsonrpc: '2.0', method: 'notifications/initialized' },
                expect.objectContaining({
                    'mcp-session-id': 'probe-session',
                    'mcp-protocol-version': '2025-03-26',
                }),
            );
            expect(deleted).toHaveBeenCalledWith('probe-session', '2025-03-26');
        },
    );

    it('reads multiline SSE data and ignores notifications and responses to other requests', async () => {
        await startServer((req, res) => {
            void readMessage(req).then((message) => {
                if (message.method === 'initialize') {
                    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                    res.write(': keepalive\r\n\r\n');
                    res.write('data: {"jsonrpc":"2.0","method":"notifications/message"}\r\n\r\n');
                    res.write(`data: ${JSON.stringify(initializeResult(2, 'OtherMcpServer'))}\r\n\r\n`);
                    const result = JSON.stringify(initializeResult(message.id), null, 2);
                    res.write(
                        `${result
                            .split('\n')
                            .map((line) => `data: ${line}`)
                            .join('\r\n')}\r\n\r\n`,
                    );
                } else {
                    res.writeHead(202).end();
                }
            });
        });

        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(true);
    });

    const validResponse = initializeResult(1);
    it.each([
        ['mismatched response ID', initializeResult(2)],
        ['missing JSON-RPC version', { ...validResponse, jsonrpc: undefined }],
        ['unsupported protocol', { ...validResponse, result: { ...validResponse.result, protocolVersion: 'unknown' } }],
        [
            'missing server version',
            { ...validResponse, result: { ...validResponse.result, serverInfo: { name: 'CosmosDBShell' } } },
        ],
        ['JSON-RPC error', { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid request' } }],
    ])('rejects initialization with %s', async (_description, response) => {
        await startServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
        });

        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(false);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('could not verify'));
    });

    it.each([
        { status: 404, contentType: 'text/event-stream' },
        { status: 405, contentType: 'text/event-stream' },
        { status: 404, contentType: 'text/event-stream; charset=utf-8' },
        { status: 405, contentType: 'text/event-stream; charset=utf-8' },
        { status: 404, contentType: 'Text/Event-Stream ; charset=utf-8' },
        { status: 405, contentType: 'Text/Event-Stream ; charset=utf-8' },
    ])('initializes legacy SSE after root HTTP $status with $contentType', async ({ status, contentType }) => {
        let events: http.ServerResponse;
        await startServer((req, res) => {
            if (req.url === '/sse') {
                events = res;
                res.writeHead(200, { 'Content-Type': contentType });
                res.write('event: endpoint\ndata: /messages\n\n');
            } else if (req.url === '/messages') {
                void readMessage(req).then((message) => {
                    res.writeHead(202).end();
                    if (message.method === 'initialize') {
                        events.write(`event: message\ndata: ${JSON.stringify(initializeResult(message.id))}\n\n`);
                    }
                });
            } else {
                res.writeHead(status).end();
            }
        });

        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(true);
    });

    it.each([
        { legacy: false, contentType: 'text/event-streaming' },
        { legacy: true, contentType: 'text/event-streaming' },
        { legacy: false, contentType: 'text/event-streaming; charset=utf-8' },
        { legacy: true, contentType: 'text/event-streaming; charset=utf-8' },
    ])('rejects $contentType despite valid MCP messages (legacy: $legacy)', async ({ legacy, contentType }) => {
        const paths: string[] = [];
        await startServer((req, res) => {
            paths.push(`${req.method} ${req.url}`);
            if (legacy && req.url === '/') {
                res.writeHead(404).end();
            } else if (req.url === '/messages' || req.headers['mcp-protocol-version']) {
                res.writeHead(202).end();
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(
                    (legacy ? 'event: endpoint\ndata: /messages\n\n' : '') +
                        `event: message\ndata: ${JSON.stringify(initializeResult(1))}\n\n`,
                );
            }
        });

        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(false);
        expect(paths).toEqual(legacy ? ['POST /', 'GET /sse'] : ['POST /']);
    });

    it.each([302, 401, 403, 500])('does not follow redirects or fall back after root HTTP %s', async (status) => {
        const paths: string[] = [];
        await startServer((req, res) => {
            paths.push(`${req.method} ${req.url}`);
            res.writeHead(status, { Location: '/sse' }).end();
        });

        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(false);
        expect(paths).toEqual(['POST /']);
    });

    it('rejects a legacy message endpoint on a different origin', async () => {
        await startServer((req, res) => {
            if (req.url === '/sse') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write('event: endpoint\ndata: http://127.0.0.1:1/messages\n\n');
            } else {
                res.writeHead(404).end();
            }
        });

        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(false);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('different origin'));
    });

    it.each(['OtherMcpServer', 'CosmosDBShell impostor'])('rejects MCP identity %s', async (name) => {
        await startServer((req, res) => {
            void readMessage(req).then((message) => {
                if (message.method === 'initialize') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(initializeResult(message.id, name)));
                } else {
                    res.writeHead(202).end();
                }
            });
        });

        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(false);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('identity other than'));
    });

    it.each(['text/html', 'application/json', 'text/event-stream'])(
        'rejects unrelated or malformed %s responses within the deadline',
        async (contentType) => {
            await startServer((_req, res) => {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(contentType === 'text/event-stream' ? 'data: {"unrelated":true}\n\n' : 'not MCP');
            });
            expect(await isMcpShellServer(port, tokenSource.token, log, 100)).toBe(false);
            expect(log).toHaveBeenCalledWith(expect.stringContaining('could not verify'));
        },
    );

    it('does not accept a generic legacy event stream without initialization', async () => {
        await startServer((req, res) => {
            if (req.url === '/sse') {
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                res.write(': keepalive\n\n');
            } else {
                res.writeHead(404).end();
            }
        });
        const start = Date.now();
        expect(await isMcpShellServer(port, tokenSource.token, log, 100)).toBe(false);
        expect(Date.now() - start).toBeLessThan(1000);
    });

    it('bounds a stalled root response and closes the connection', async () => {
        const closed = vi.fn();
        await startServer((_req, res) => {
            res.on('close', closed);
        });
        const start = Date.now();
        expect(await isMcpShellServer(port, tokenSource.token, log, 100)).toBe(false);
        expect(Date.now() - start).toBeLessThan(1000);
        await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    });

    it('bounds a response that keeps sending SSE keepalives', async () => {
        const closed = vi.fn();
        await startServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(': keepalive\n\n');
            const interval = setInterval(() => res.write(': keepalive\n\n'), 10);
            res.on('close', () => {
                clearInterval(interval);
                closed();
            });
        });
        const start = Date.now();
        expect(await isMcpShellServer(port, tokenSource.token, log, 100)).toBe(false);
        expect(Date.now() - start).toBeLessThan(1000);
        await vi.waitFor(() => expect(closed).toHaveBeenCalled());
    });

    it('deletes a session even when initialization is malformed', async () => {
        const deleted = vi.fn();
        await startServer((req, res) => {
            if (req.method === 'DELETE') {
                deleted(req.headers['mcp-session-id']);
                res.writeHead(200).end();
            } else {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Mcp-Session-Id': 'failed-probe-session',
                });
                res.end('not JSON');
            }
        });
        expect(await isMcpShellServer(port, tokenSource.token, log, 100)).toBe(false);
        expect(deleted).toHaveBeenCalledWith('failed-probe-session');
    });

    it('cancels an in-flight probe and releases its listener and connection', async () => {
        const closed = vi.fn();
        const dispose = vi.fn();
        const original = tokenSource.token.onCancellationRequested;
        vi.spyOn(tokenSource.token, 'onCancellationRequested').mockImplementation((listener) => {
            const subscription = original(listener);
            return {
                dispose: () => {
                    dispose();
                    subscription.dispose();
                },
            };
        });
        await startServer((_req, res) => {
            res.on('close', closed);
            tokenSource.cancel();
        });
        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(false);
        expect(dispose).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(closed).toHaveBeenCalled());
        expect(log).not.toHaveBeenCalled();
    });

    it('does not connect when already cancelled', async () => {
        tokenSource.cancel();
        const handler = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => res.end());
        await startServer(handler);
        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(false);
        expect(handler).not.toHaveBeenCalled();
    });

    it('bounds and logs stalled session cleanup without rejecting a healthy Shell', async () => {
        const cleanupClosed = vi.fn();
        await startServer((req, res) => {
            if (req.method === 'DELETE') {
                res.on('close', cleanupClosed);
            } else if (req.method === 'GET') {
                res.writeHead(405).end();
            } else {
                void readMessage(req).then((message) => {
                    if (message.method === 'initialize') {
                        res.writeHead(200, {
                            'Content-Type': 'application/json',
                            'Mcp-Session-Id': 'probe-session',
                        });
                        res.end(JSON.stringify(initializeResult(message.id)));
                    } else {
                        res.writeHead(202).end();
                    }
                });
            }
        });
        const start = Date.now();
        expect(await isMcpShellServer(port, tokenSource.token, log)).toBe(true);
        expect(Date.now() - start).toBeLessThan(1500);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('could not terminate probe session'));
        await vi.waitFor(() => expect(cleanupClosed).toHaveBeenCalled());
    });
});
