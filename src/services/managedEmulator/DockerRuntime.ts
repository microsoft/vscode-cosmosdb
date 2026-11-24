/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile, type ExecFileOptions } from 'child_process';
import { createHash, X509Certificate } from 'crypto';
import { createServer, type Server } from 'net';
import { z } from 'zod';
import { wellKnownEmulatorPassword } from '../../cosmosdb/cosmosdb-shared-constants';
import {
    emulatorImage,
    EmulatorError,
    loopback,
    type ContainerEngine,
    type EmulatorLease,
    type EmulatorPorts,
} from './model';

const ownerLabel = 'com.microsoft.vscode-cosmosdb.emulator';
const operationLabel = `${ownerLabel}.operation`;
const roleLabel = `${ownerLabel}.role`;
const dataPath = '/usr/cosmos/data';
const permissionDenied = /permission denied|access (?:is )?denied|requires elevated privileges/i;
const portConflict = /port is already allocated|address already in use|ports are not available/i;

interface Container {
    readonly id: string;
    readonly running: boolean;
}

export interface ContainerSession {
    readonly engineId: string;
    checkPorts(ports: EmulatorPorts, signal: AbortSignal): Promise<void>;
    pull(signal: AbortSignal): Promise<void>;
    createVolume(lease: EmulatorLease): Promise<void>;
    requireVolume(lease: EmulatorLease): Promise<void>;
    createContainer(lease: EmulatorLease): Promise<void>;
    container(lease: EmulatorLease): Promise<Container | undefined>;
    certificate(lease: EmulatorLease, signal?: AbortSignal): Promise<string>;
    start(lease: EmulatorLease): Promise<void>;
    stop(lease: EmulatorLease): Promise<void>;
    removeContainer(lease: EmulatorLease): Promise<void>;
    removeVolume(lease: EmulatorLease): Promise<void>;
    logs(lease: EmulatorLease): Promise<string>;
}

export interface ContainerRuntime {
    connect(engine: ContainerEngine, signal?: AbortSignal): Promise<ContainerSession>;
    installed(engine: ContainerEngine, signal?: AbortSignal): Promise<boolean>;
}

export type EngineCommand = (engine: ContainerEngine, args: string[], options?: ExecFileOptions) => Promise<string>;
type BoundCommand = (args: string[], options?: ExecFileOptions) => Promise<string>;

const runEngine: EngineCommand = (engine, args, options) =>
    new Promise((resolve, reject) => {
        execFile(
            engine,
            args,
            { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true, ...options },
            (error, stdout, stderr) =>
                error
                    ? reject(Object.assign(new Error('Container CLI failed'), { code: error.code, stderr }))
                    : resolve(args.includes('logs') ? `${String(stdout)}\n${String(stderr)}` : String(stdout)),
        );
    });

function errorCode(error: unknown): unknown {
    return error && typeof error === 'object' && 'code' in error ? error.code : undefined;
}

function engineError(error: unknown, preflight: boolean, engine: ContainerEngine): EmulatorError {
    if (errorCode(error) === 'ABORT_ERR') return new EmulatorError('cancelled');
    if (errorCode(error) === 'ENOENT')
        return new EmulatorError(engine === 'docker' ? 'dockerMissing' : 'podmanMissing');
    const diagnostic = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    if (permissionDenied.test(diagnostic)) return new EmulatorError('dockerPermissions');
    if (portConflict.test(diagnostic)) return new EmulatorError('portConflict');
    return new EmulatorError(preflight ? (engine === 'docker' ? 'dockerStopped' : 'podmanStopped') : 'dockerOperation');
}

export function maskEmulatorLogs(raw: string): string {
    return (
        raw
            .replaceAll(wellKnownEmulatorPassword, '[REDACTED]')
            .replace(
                /\b(?:authorization|accountkey|password|access[_-]?token|client[_-]?secret)\b["']?\s*[:=][^\r\n]*/gi,
                '[REDACTED]',
            )
            // oxlint-disable-next-line no-control-regex -- Strip terminal escape sequences from untrusted CLI output.
            .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    );
}

function name(lease: EmulatorLease): string {
    return `vscode-cosmosdb-${lease.id}`;
}

function volume(lease: EmulatorLease): string {
    return `${name(lease)}-data`;
}

function labels(lease: EmulatorLease, operation: string): string[] {
    return ['--label', `${ownerLabel}=${lease.id}`, '--label', `${operationLabel}=${operation}`];
}

async function checkPorts(ports: EmulatorPorts, signal: AbortSignal): Promise<void> {
    const servers: Server[] = [];
    try {
        for (const port of [ports.endpoint, ports.explorer]) {
            if (signal.aborted) throw new EmulatorError('cancelled');
            const server = createServer();
            servers.push(server);
            await new Promise<void>((resolve, reject) => {
                server.once('error', () => reject(new EmulatorError('portConflict')));
                server.listen({ host: loopback, port, exclusive: true }, resolve);
            });
        }
    } finally {
        await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    }
}

export class CliContainerRuntime implements ContainerRuntime {
    public constructor(
        private readonly command: EngineCommand = runEngine,
        private readonly platform = process.platform,
    ) {}

    public async installed(engine: ContainerEngine, signal?: AbortSignal): Promise<boolean> {
        try {
            await this.command(engine, ['--version'], { signal });
            return true;
        } catch (error) {
            if (errorCode(error) === 'ENOENT') return false;
            throw engineError(error, true, engine);
        }
    }

    public async connect(engine: ContainerEngine, signal?: AbortSignal): Promise<ContainerSession> {
        return engine === 'docker' ? this.connectDocker(signal) : this.connectPodman(signal);
    }

    private async connectDocker(signal?: AbortSignal): Promise<ContainerSession> {
        // Resolve Docker's selected context once, refusing endpoints that are not on the extension host.
        const cli = async (args: string[]): Promise<string> => {
            try {
                return (await this.command('docker', args, { signal })).trim();
            } catch (error) {
                throw engineError(error, true, 'docker');
            }
        };
        const host =
            (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST) ||
            (await cli(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']));
        if (!/^(?:unix:\/\/\/[^\r\n]+|npipe:\/\/\/\/\.\/pipe\/[\w.-]+)$/i.test(host)) {
            throw new EmulatorError('dockerRemote');
        }
        // DOCKER_CONTEXT takes precedence over DOCKER_HOST in the environment. Pin every command explicitly.
        const env = { ...process.env };
        delete env.DOCKER_CONTEXT;
        delete env.DOCKER_HOST;
        const run = (args: string[], options?: ExecFileOptions) =>
            this.command('docker', ['--host', host, ...args], { ...options, env });
        let info: string;
        try {
            info = (await run(['info', '--format', '{{.OSType}} {{.ServerVersion}} {{.ID}}'], { signal })).trim();
        } catch (error) {
            throw engineError(error, true, 'docker');
        }
        const [os, version, id] = info.split(/\s+/);
        if (os !== 'linux' || !version || !/^\d+\./.test(version) || Number(version.split('.')[0]) < 28 || !id) {
            throw new EmulatorError('dockerUnsupported');
        }
        return new CliSession('docker', id, run);
    }

    private async connectPodman(signal?: AbortSignal): Promise<ContainerSession> {
        const env = { ...process.env };
        delete env.CONTAINER_CONNECTION;
        delete env.CONTAINER_HOST;
        delete env.CONTAINER_SSHKEY;
        const run = async (args: string[], options?: ExecFileOptions) => {
            try {
                return await this.command('podman', args, { ...options, env });
            } catch (error) {
                throw engineError(error, true, 'podman');
            }
        };
        let args = ['--remote=false'];
        let connection = 'local';
        if (this.platform !== 'linux') {
            const machines = parseOutput(
                await run(['machine', 'list', '--format', 'json'], { signal }),
                z.array(z.object({ Name: z.string() })).nullable(),
            );
            if (!machines?.length) throw new EmulatorError('podmanMachineMissing');
            const connections = parseOutput(
                await run(['system', 'connection', 'list', '--format', 'json'], { signal }),
                z.array(z.object({ Name: z.string(), URI: z.string(), Identity: z.string(), Default: z.boolean() })),
            );
            const selected = connections.find((candidate) => candidate.Default);
            if (!selected || !machines.some(({ Name }) => selected.Name === Name || selected.Name === `${Name}-root`)) {
                throw new EmulatorError('podmanUnsupported');
            }
            const uri = URL.canParse(selected.URI) ? new URL(selected.URI) : undefined;
            if (
                uri?.protocol !== 'ssh:' ||
                !['127.0.0.1', 'localhost', '[::1]'].includes(uri.hostname) ||
                !uri.port ||
                !selected.Identity
            ) {
                throw new EmulatorError('podmanUnsupported');
            }
            args = ['--remote=true', '--url', selected.URI, '--identity', selected.Identity];
            connection = selected.Name;
        }
        const info = parseOutput(
            await run([...args, 'info', '--format', 'json'], { signal }),
            z.object({
                host: z.object({
                    os: z.literal('linux'),
                    hostname: z.string(),
                    security: z.object({ rootless: z.boolean() }),
                }),
                store: z.object({ graphRoot: z.string() }),
                version: z.object({ Version: z.string() }),
            }),
        );
        const [major, minor] = info.version.Version.split('.').map(Number);
        const supported = major >= 5 || (this.platform === 'linux' && major === 4 && minor >= 9);
        if (!supported) {
            throw new EmulatorError('podmanUnsupported');
        }
        const id = createHash('sha256')
            .update(JSON.stringify([connection, info.host.hostname, info.host.security.rootless, info.store.graphRoot]))
            .digest('hex');
        return new CliSession('podman', id, (command, options) =>
            this.command('podman', [...args, ...command], { ...options, env }),
        );
    }
}

function parseOutput<T>(output: string, schema: z.ZodType<T>): T {
    try {
        return schema.parse(JSON.parse(output));
    } catch {
        throw new EmulatorError('dockerOperation');
    }
}

class CliSession implements ContainerSession {
    public constructor(
        private readonly engine: ContainerEngine,
        public readonly engineId: string,
        private readonly command: BoundCommand,
    ) {}

    private async run(args: string[], options?: ExecFileOptions): Promise<string> {
        try {
            return (await this.command(args, options)).trim();
        } catch (error) {
            throw engineError(error, false, this.engine);
        }
    }

    public checkPorts = checkPorts;

    public async pull(signal: AbortSignal): Promise<void> {
        await this.run(['pull', emulatorImage], { timeout: 15 * 60_000, signal });
    }

    private async ownedVolume(lease: EmulatorLease): Promise<boolean> {
        const names = (await this.run(['volume', 'ls', '--format', '{{.Name}}'])).split(/\r?\n/);
        if (!names.includes(volume(lease))) return false;
        const [details] = parseOutput(
            await this.run(['volume', 'inspect', volume(lease)]),
            z.array(
                z.object({
                    Name: z.string(),
                    Labels: z.record(z.string(), z.string()).nullish(),
                }),
            ),
        );
        if (
            details?.Name !== volume(lease) ||
            details.Labels?.[ownerLabel] !== lease.id ||
            details.Labels[operationLabel] !== lease.volumeOperation
        )
            throw new EmulatorError('ownership');
        return true;
    }

    public async createVolume(lease: EmulatorLease): Promise<void> {
        await this.run(['volume', 'create', ...labels(lease, lease.volumeOperation), volume(lease)]);
        await this.requireVolume(lease);
        await this.run(
            [
                'container',
                'create',
                '--name',
                `${name(lease)}-init`,
                '--pull=never',
                ...labels(lease, lease.containerOperation),
                '--label',
                `${roleLabel}=init`,
                '--network',
                'none',
                '--user',
                '0:0',
                '--entrypoint',
                '/bin/sh',
                '--mount',
                `type=volume,source=${volume(lease)},target=${dataPath}`,
                emulatorImage,
                '-c',
                `chown 1000:1000 ${dataPath}`,
            ],
            { timeout: 90_000 },
        );
        const initializer = await this.inspectContainer(lease, 'init');
        if (!initializer) throw new EmulatorError('ownership');
        await this.run(['container', 'start', '--attach', initializer.id], { timeout: 90_000 });
        await this.removeRole(lease, 'init');
    }

    public async requireVolume(lease: EmulatorLease): Promise<void> {
        if (!(await this.ownedVolume(lease))) throw new EmulatorError('ownership');
    }

    public async createContainer(lease: EmulatorLease): Promise<void> {
        await this.requireVolume(lease);
        // Podman rejects uid/gid on tmpfs. A sticky, empty directory lets the unprivileged emulator create its socket.
        const socketMount =
            this.engine === 'podman' ? '/socket:mode=1777,notmpcopyup' : '/socket:uid=1000,gid=1000,mode=0755';
        await this.run(
            [
                'container',
                'create',
                '--name',
                name(lease),
                '--pull=never',
                ...labels(lease, lease.containerOperation),
                '--label',
                `${roleLabel}=emulator`,
                '--publish',
                `${loopback}:${lease.ports.endpoint}:8081`,
                '--publish',
                `${loopback}:${lease.ports.explorer}:1234`,
                '--env',
                'PROTOCOL=https',
                '--env',
                `DATA_PATH=${dataPath}`,
                '--mount',
                `type=volume,source=${volume(lease)},target=${dataPath}`,
                '--tmpfs',
                socketMount,
                emulatorImage,
            ],
            { timeout: 90_000 },
        );
    }

    public async container(lease: EmulatorLease): Promise<Container | undefined> {
        return this.inspectContainer(lease, 'emulator');
    }

    public async certificate(lease: EmulatorLease, signal?: AbortSignal): Promise<string> {
        const container = await this.container(lease);
        if (!container?.running) throw new EmulatorError('missing');
        // Read only the public CA from the owned container, not from the published port or the host trust store.
        const pem = await this.run(['container', 'exec', container.id, 'cat', '/scripts/certs/rootCA.crt'], {
            signal,
            timeout: 4_000,
        });
        try {
            const ca = new X509Certificate(pem);
            if (ca.ca && ca.verify(ca.publicKey)) return ca.toString();
        } catch {
            throw new EmulatorError('certificate');
        }
        throw new EmulatorError('certificate');
    }

    private async inspectContainer(lease: EmulatorLease, role: 'emulator' | 'init'): Promise<Container | undefined> {
        const resourceName = role === 'init' ? `${name(lease)}-init` : name(lease);
        const rows = (
            await this.run(['container', 'ls', '--all', '--no-trunc', '--format', '{{.ID}}|{{.Names}}'])
        ).split(/\r?\n/);
        const named = rows.find((line) => line.split('|')[1] === resourceName)?.split('|')[0];
        const labelled = (
            await this.run([
                'container',
                'ls',
                '--all',
                '--no-trunc',
                '--quiet',
                '--filter',
                `label=${ownerLabel}=${lease.id}`,
                '--filter',
                `label=${operationLabel}=${lease.containerOperation}`,
                '--filter',
                `label=${roleLabel}=${role}`,
            ])
        )
            .split(/\r?\n/)
            .filter(Boolean);
        const id = named ?? labelled[0];
        if (!id) return undefined;
        if (!/^[\da-f]{64}$/i.test(id) || labelled.length !== 1 || labelled[0] !== id)
            throw new EmulatorError('ownership');
        const [details] = parseOutput(
            await this.run(['container', 'inspect', id]),
            z.array(
                z.object({
                    Config: z.object({ Labels: z.record(z.string(), z.string()).nullish() }),
                    State: z.object({ Running: z.boolean() }),
                }),
            ),
        );
        if (
            details?.Config.Labels?.[ownerLabel] !== lease.id ||
            details.Config.Labels[operationLabel] !== lease.containerOperation ||
            details.Config.Labels[roleLabel] !== role
        )
            throw new EmulatorError('ownership');
        return { id, running: details.State.Running };
    }

    public async start(lease: EmulatorLease): Promise<void> {
        const container = await this.container(lease);
        if (!container) throw new EmulatorError('missing');
        await this.requireVolume(lease);
        if (!container.running) await this.run(['container', 'start', container.id], { timeout: 90_000 });
    }

    public async stop(lease: EmulatorLease): Promise<void> {
        const container = await this.container(lease);
        if (container?.running) await this.run(['container', 'stop', container.id], { timeout: 90_000 });
    }

    public async removeContainer(lease: EmulatorLease): Promise<void> {
        await this.removeRole(lease, 'emulator');
        await this.removeRole(lease, 'init');
    }

    private async removeRole(lease: EmulatorLease, role: 'emulator' | 'init'): Promise<void> {
        const container = await this.inspectContainer(lease, role);
        if (!container) return;
        if (container.running) await this.run(['container', 'stop', container.id], { timeout: 90_000 });
        await this.run(['container', 'rm', container.id]);
    }

    public async removeVolume(lease: EmulatorLease): Promise<void> {
        if (await this.ownedVolume(lease)) await this.run(['volume', 'rm', volume(lease)]);
    }

    public async logs(lease: EmulatorLease): Promise<string> {
        const container = await this.container(lease);
        if (!container) throw new EmulatorError('missing');
        // Docker multiplexes a container's stdout and stderr onto the same CLI streams.
        return maskEmulatorLogs(await this.run(['logs', '--tail', '200', container.id], { encoding: 'utf8' }));
    }
}
