/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { type ReadableStream } from 'node:stream/web';
import { type CancellationToken } from 'vscode';
import { z } from 'zod';
import { getCosmosDBShellMcpEndpoint } from './cosmosDBShellMcpEndpoint';

const protocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'] as const;
const initializeResponseSchema = z.object({
    jsonrpc: z.literal('2.0'),
    id: z.literal(1),
    result: z.object({
        protocolVersion: z.enum(protocolVersions),
        capabilities: z.object({}),
        serverInfo: z.object({ name: z.string(), version: z.string() }),
    }),
});

async function* readEvents(response: Response): AsyncGenerator<{ event: string; data: string }> {
    if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream') || !response.body) {
        await response.body?.cancel();
        throw new Error(`MCP event stream unavailable (HTTP ${response.status}).`);
    }

    const input = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
    const lines = createInterface({ input, crlfDelay: Infinity });
    let event = 'message';
    let data: string[] = [];
    try {
        for await (const line of lines) {
            if (line === '') {
                if (data.length) {
                    yield { event, data: data.join('\n') };
                }
                event = 'message';
                data = [];
            } else {
                const separator = line.indexOf(':');
                const field = separator < 0 ? line : line.slice(0, separator);
                const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
                if (field === 'event') {
                    event = value || 'message';
                } else if (field === 'data') {
                    data.push(value);
                }
            }
        }
    } finally {
        lines.close();
        input.destroy();
    }
}

/**
 * Identify Shell by an MCP initialization response, not by an HTTP content type.
 * Both transports share a wall-clock deadline, including servers that keep sending data without completing initialization.
 */
export async function isMcpShellServer(
    port: string,
    token: CancellationToken,
    log: (message: string) => void,
    timeoutMs = 3000,
): Promise<boolean> {
    if (token.isCancellationRequested) {
        return false;
    }

    const endpoint = new URL(getCosmosDBShellMcpEndpoint(port));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('MCP identity probe timed out.')), timeoutMs);
    const cancellation = token.onCancellationRequested(() =>
        controller.abort(new Error('MCP identity probe cancelled.')),
    );
    let sessionId: string | null = null;
    let protocolVersion: string | undefined;
    const initialize = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: protocolVersions[0],
            capabilities: {},
            clientInfo: { name: 'cosmosdb-shell-identity-probe', version: '1.0.0' },
        },
    };
    const post = (url: URL, message: unknown): Promise<Response> =>
        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
                ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
            },
            body: JSON.stringify(message),
            redirect: 'error',
            signal: controller.signal,
        });

    const complete = async (message: unknown, url: URL): Promise<boolean> => {
        const { result } = initializeResponseSchema.parse(message);
        protocolVersion = result.protocolVersion;
        const response = await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' });
        await response.body?.cancel();
        if (!response.ok) {
            throw new Error(`MCP initialized notification returned HTTP ${response.status}.`);
        }
        const isShell = result.serverInfo.name === 'CosmosDBShell';
        if (!isShell) {
            log('MCP resolve: initialization returned a server identity other than CosmosDBShell.');
        }
        return isShell;
    };

    try {
        let response = await post(endpoint, initialize);
        let messageEndpoint: URL | undefined = endpoint;
        if (response.status === 404 || response.status === 405) {
            await response.body?.cancel();
            log('MCP resolve: root endpoint does not support streamable HTTP; checking legacy SSE.');
            messageEndpoint = undefined;
            response = await fetch(new URL('/sse', endpoint), {
                headers: { Accept: 'text/event-stream' },
                redirect: 'error',
                signal: controller.signal,
            });
        } else {
            sessionId = response.headers.get('mcp-session-id');
            if (!response.ok) {
                await response.body?.cancel();
                throw new Error(`MCP initialization returned HTTP ${response.status}.`);
            }
            if (response.headers.get('content-type')?.split(';')[0].trim() === 'application/json') {
                return await complete(await response.json(), endpoint);
            }
        }

        for await (const { event, data } of readEvents(response)) {
            if (event === 'endpoint' && !messageEndpoint) {
                messageEndpoint = new URL(data, new URL('/sse', endpoint));
                if (messageEndpoint.origin !== endpoint.origin) {
                    throw new Error('MCP legacy endpoint has a different origin.');
                }
                const posted = await post(messageEndpoint, initialize);
                await posted.body?.cancel();
                if (!posted.ok) {
                    throw new Error(`MCP initialization returned HTTP ${posted.status}.`);
                }
            } else if (event === 'message' && messageEndpoint) {
                const message: unknown = JSON.parse(data);
                if (message && typeof message === 'object' && 'id' in message && message.id === initialize.id) {
                    return await complete(message, messageEndpoint);
                }
            }
        }
        throw new Error('MCP event stream ended before initialization.');
    } catch (error) {
        if (!token.isCancellationRequested) {
            log(`MCP resolve: could not verify Cosmos DB Shell identity: ${String(error)}`);
        }
        return false;
    } finally {
        clearTimeout(timeout);
        cancellation.dispose();
        controller.abort();
        if (sessionId) {
            try {
                const response = await fetch(endpoint, {
                    method: 'DELETE',
                    headers: {
                        'Mcp-Session-Id': sessionId,
                        ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
                    },
                    redirect: 'error',
                    signal: AbortSignal.timeout(500),
                });
                await response.body?.cancel();
                if (!response.ok && response.status !== 405) {
                    log(`MCP resolve: probe session cleanup returned HTTP ${response.status}.`);
                }
            } catch (error) {
                log(`MCP resolve: could not terminate probe session: ${String(error)}`);
            }
        }
    }
}
