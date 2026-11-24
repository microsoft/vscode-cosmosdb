/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import { createRequire } from 'node:module';
import { createConnection, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { connect as connectTls } from 'node:tls';
import { afterAll, describe, expect, it, vi } from 'vitest';

const canaryMode = process.env.VITEST_LOOPBACK_GUARD_CANARY;
const isCanary = canaryMode !== undefined;
const allowsExternal = process.env.VITEST_ALLOW_EXTERNAL_NETWORK === '1';
const testHost = 'network-guard.invalid';
const blockedMessage = 'TCP host blocked by the Vitest loopback guard';

async function withLoopbackServer(work: (port: number) => Promise<void>): Promise<void> {
    const server = createServer((_request, response) => response.end('loopback'));

    server.listen(0, '127.0.0.1');
    try {
        await once(server, 'listening');
        const address = server.address();

        if (typeof address !== 'object' || address === null) {
            throw new Error('Expected a TCP server address.');
        }

        await work(address.port);
    } finally {
        await server[Symbol.asyncDispose]();
    }
}

it.skipIf(!isCanary || allowsExternal)('network guard subprocess canary: blocks TCP, HTTP, TLS and fetch', async () => {
    const socket = new Socket();
    const lookup = vi.fn(() => {
        throw new Error('External host must be blocked before DNS.');
    });

    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    // Use a non-allowlisted loopback address so a broken guard cannot make an external request.
    expect(() => socket.connect(80, '127.0.0.2')).toThrow(blockedMessage);
    expect(() => createConnection({ port: 80, host: testHost, lookup })).toThrow(blockedMessage);
    expect(lookup).not.toHaveBeenCalled();
    expect(() => get('http://127.0.0.2')).toThrow(blockedMessage);
    expect(() => connectTls(443, '127.0.0.2')).toThrow(blockedMessage);
    await expect(fetch('http://127.0.0.2', { signal: AbortSignal.timeout(1_000) })).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringContaining(blockedMessage) }),
    });
});

it.skipIf(!isCanary || !allowsExternal)('network guard subprocess canary: opts out explicitly', async () => {
    await withLoopbackServer(async (port) => {
        const socket = createConnection({
            host: testHost,
            port,
            autoSelectFamily: false,
            lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4),
        });

        try {
            await once(socket, 'connect');
            expect(socket.remoteAddress).toBe('127.0.0.1');
        } finally {
            socket.destroy();
        }
    });
});

it.skipIf(canaryMode !== 'late teardown')('network guard subprocess canary: late teardown', () => {
    expect(allowsExternal).toBe(false);
});

function attemptConnectionDuringTeardown(): void {
    expect(() => new Socket().connect(80, '127.0.0.2')).toThrow(blockedMessage);
}

// List ordering runs this root hook after the setup-file root hook.
afterAll(canaryMode === 'late teardown' ? attemptConnectionDuringTeardown : () => {});

describe.skipIf(isCanary || allowsExternal)('Vitest loopback network guard', () => {
    it('allows loopback fetch and resolves localhost without calling a custom lookup', async () => {
        await withLoopbackServer(async (port) => {
            const response = await fetch(`http://127.0.0.1:${port}`);
            const lookup = vi.fn(() => {
                throw new Error('localhost must not run a custom DNS lookup.');
            });

            expect(await response.text()).toBe('loopback');

            const socket = createConnection({ host: 'localhost', port, lookup });

            try {
                await once(socket, 'connect');
                expect(socket.remoteAddress).toBe('127.0.0.1');
                expect(lookup).not.toHaveBeenCalled();
            } finally {
                socket.destroy();
            }
        });
    });

    it('preserves local IPC sockets', async () => {
        const name = `cosmosdb-${randomUUID()}`;
        const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), name);
        const server = createServer();

        server.listen(endpoint);
        try {
            await once(server, 'listening');
            const socket = createConnection(endpoint);

            try {
                await once(socket, 'connect');
                expect(socket.readyState).toBe('open');
            } finally {
                socket.destroy();
            }
        } finally {
            await server[Symbol.asyncDispose]();
        }
    });

    it.each([
        { canary: 'blocks TCP', allowExternal: '0', expectedStatus: 1 },
        { canary: 'opts out explicitly', allowExternal: '1', expectedStatus: 0 },
        { canary: 'late teardown', allowExternal: '0', expectedStatus: 1 },
    ])(
        'enforces the worker guard for $canary',
        ({ canary, allowExternal, expectedStatus }) => {
            const require = createRequire(import.meta.url);
            const vitestCli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
            const child = spawnSync(
                process.execPath,
                [
                    vitestCli,
                    'run',
                    import.meta.filename,
                    '-t',
                    `network guard subprocess canary: ${canary}`,
                    '--reporter=default',
                    '--sequence.hooks=list',
                ],
                {
                    encoding: 'utf8',
                    env: {
                        ...process.env,
                        NO_COLOR: '1',
                        FORCE_COLOR: '0',
                        NO_PROXY: '*',
                        VITEST_ALLOW_EXTERNAL_NETWORK: allowExternal,
                        VITEST_LOOPBACK_GUARD_CANARY: canary,
                    },
                    timeout: 25_000,
                },
            );
            const output = child.stdout + child.stderr;

            expect(child.error).toBeUndefined();
            // Catching the connection error must not prevent the worker from failing the run.
            expect(output).toMatch(/Tests\s+1 passed/);
            expect(child.status).toBe(expectedStatus);
            expect(output.includes('Loopback Network Guard')).toBe(expectedStatus !== 0);
        },
        30_000,
    );
});
