/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { type PoolOptions, type PoolRunnerInitializer, type PoolWorker, type WorkerRequest } from 'vitest/node';
import { WorkerChannel } from './workerChannel.js';

class VSCodeWorker extends EventEmitter implements PoolWorker {
    readonly name = 'vscode';
    private readonly server = createServer();
    private socket?: Socket;
    private channel?: WorkerChannel;
    private process?: ChildProcess;
    private readonly connected = Promise.withResolvers<void>();
    private readonly exited = Promise.withResolvers<void>();
    private failure?: Error;
    private stopping = false;

    constructor(private readonly options: PoolOptions) {
        super();
        // Vitest attaches its error listener only after start() returns.
        this.on('error', (error: Error) => {
            this.failure ??= error;
            this.connected.reject(error);
        });
    }

    async start(): Promise<void> {
        const executable = process.env.COSMOSDB_TEST_VSCODE_PATH;
        if (!executable) {
            throw new Error('Launch integration tests with npm test so VS Code is prepared first.');
        }
        const id = `cv-${randomUUID()}`;
        const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(tmpdir(), `${id}.sock`);
        this.server.once('connection', (socket) => {
            this.server.close();
            this.socket = socket;
            this.channel = new WorkerChannel(socket);
            this.channel.on('message', (message: unknown) => this.emit('message', message));
            this.channel.on('error', (error: Error) => this.emit('error', error));
            socket.once('close', () => {
                if (!this.stopping) this.emit('error', new Error('The VS Code worker disconnected unexpectedly.'));
            });
            this.connected.resolve();
        });
        this.server.listen(pipe);
        await once(this.server, 'listening');
        this.server.on('error', (error) => this.emit('error', error));

        const root = this.options.project.config.root;
        const [, ...profileArgs] = resolveCliArgsFromVSCodeExecutablePath(executable);
        // Own the process handle so a failed startup or shutdown can terminate this instance, not the user's VS Code.
        this.process = spawn(
            executable,
            [
                ...profileArgs,
                '--no-sandbox',
                '--disable-gpu-sandbox',
                '--disable-updates',
                '--skip-welcome',
                '--skip-release-notes',
                '--no-cached-data',
                '--disable-workspace-trust',
                `--extensionDevelopmentPath=${path.join(root, 'dist')}`,
                `--extensionTestsPath=${path.join(root, 'out', 'test', 'index.js')}`,
            ],
            {
                env: { ...process.env, ...this.options.env, COSMOSDB_TEST_PIPE: pipe, DEBUGTELEMETRY: 'v' },
                stdio: ['ignore', 'inherit', 'inherit'],
            },
        );
        this.process.once('error', (error) => this.emit('error', error));
        this.process.once('close', (code, signal) => {
            this.exited.resolve();
            this.socket?.destroy();
            if (!this.stopping || code !== 0) {
                this.emit('error', new Error(`VS Code exited unexpectedly (code: ${code}, signal: ${signal}).`));
            }
        });
        try {
            await withTimeout(this.connected.promise, 60_000, 'VS Code did not connect to Vitest within 60 seconds.');
        } catch (error) {
            await this.stop();
            throw error;
        }
    }

    send(message: WorkerRequest): void {
        if (!this.channel) throw new Error('The VS Code worker is not connected.');
        this.channel.send(message);
    }

    deserialize(message: unknown): unknown {
        return message;
    }

    async stop(): Promise<void> {
        if (this.stopping) return;
        this.stopping = true;
        this.socket?.end();
        try {
            if (this.process) {
                try {
                    await withTimeout(this.exited.promise, 10_000, 'VS Code did not shut down within 10 seconds.');
                } catch (error) {
                    if (this.process.pid) {
                        if (process.platform === 'win32') {
                            await promisify(execFile)('taskkill', ['/pid', String(this.process.pid), '/t', '/f']);
                        } else {
                            this.process.kill('SIGKILL');
                        }
                    }
                    throw error;
                }
            }
        } finally {
            this.socket?.destroy();
            if (this.server.listening) {
                await new Promise<void>((resolve, reject) => {
                    this.server.close((error) => (error ? reject(error) : resolve()));
                });
            }
        }
        if (this.failure) throw this.failure;
    }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(message)), milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

export function vscodePool(): PoolRunnerInitializer {
    let created = false;
    return {
        name: 'vscode',
        createPoolWorker: (options) => {
            if (created) throw new Error('The VS Code pool supports one Extension Host only.');
            created = true;
            return new VSCodeWorker(options);
        },
    };
}
