/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type CancellationToken } from 'vscode';
import { getCosmosDBShellMcpEndpoint } from './cosmosDBShellMcpEndpoint';

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
    const probeFetch: typeof fetch = (input, init) =>
        fetch(input, {
            ...init,
            redirect: 'error',
            signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
        });

    const probe = async (transport: StreamableHTTPClientTransport | SSEClientTransport): Promise<boolean> => {
        const client = new Client({ name: 'cosmosdb-shell-identity-probe', version: '1.0.0' });
        let abortListener: (() => void) | undefined;
        try {
            // Closing an SSE transport before its endpoint event does not settle start(), so race the entire handshake.
            const aborted = new Promise<never>((_resolve, reject) => {
                abortListener = () => {
                    const reason: unknown = controller.signal.reason;
                    reject(reason instanceof Error ? reason : new Error('MCP identity probe aborted.'));
                };
                controller.signal.addEventListener('abort', abortListener, { once: true });
                if (controller.signal.aborted) {
                    abortListener();
                }
            });
            await Promise.race([client.connect(transport, { signal: controller.signal }), aborted]);
            const isShell = client.getServerVersion()?.name === 'CosmosDBShell';
            if (!isShell) {
                log('MCP resolve: initialization returned a server identity other than CosmosDBShell.');
            }
            return isShell;
        } finally {
            if (abortListener) {
                controller.signal.removeEventListener('abort', abortListener);
            }
            // Initialization creates a separate session; never terminate the session used by VS Code.
            // Use an independent deadline because a failed handshake may already have closed/aborted the transport.
            if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) {
                try {
                    const response = await fetch(endpoint, {
                        method: 'DELETE',
                        headers: {
                            'Mcp-Session-Id': transport.sessionId,
                            ...(transport.protocolVersion ? { 'MCP-Protocol-Version': transport.protocolVersion } : {}),
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
            await client.close();
            await transport.close();
        }
    };

    try {
        try {
            return await probe(new StreamableHTTPClientTransport(endpoint, { fetch: probeFetch }));
        } catch (error) {
            if (
                controller.signal.aborted ||
                !(error instanceof StreamableHTTPError) ||
                (error.code !== 404 && error.code !== 405)
            ) {
                throw error;
            }
            log('MCP resolve: root endpoint does not support streamable HTTP; checking legacy SSE.');
            return await probe(new SSEClientTransport(new URL('/sse', endpoint), { fetch: probeFetch }));
        }
    } catch (error) {
        if (!token.isCancellationRequested) {
            log(`MCP resolve: could not verify Cosmos DB Shell identity: ${String(error)}`);
        }
        return false;
    } finally {
        clearTimeout(timeout);
        cancellation.dispose();
        controller.abort();
    }
}
