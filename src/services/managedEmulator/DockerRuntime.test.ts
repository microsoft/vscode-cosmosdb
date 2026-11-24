/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import { wellKnownEmulatorPassword } from '../../cosmosdb/cosmosdb-shared-constants';
import { CliContainerRuntime, maskEmulatorLogs, type EngineCommand } from './DockerRuntime';
import { defaultPorts, type EmulatorLease } from './model';

const lease: EmulatorLease = {
    id: 'instance',
    volumeOperation: 'volume-op',
    containerOperation: 'container-op',
    engineId: 'engine',
    engine: 'docker',
    ports: defaultPorts,
    phase: 'ready',
    newVolume: false,
    stage: 'connection',
};

afterEach(() => vi.unstubAllEnvs());

describe('CliContainerRuntime', () => {
    it('reports missing CLI and a missing Podman machine separately', async () => {
        const command = vi.fn<EngineCommand>();
        command.mockRejectedValueOnce({ code: 'ENOENT' }).mockResolvedValueOnce('[]');
        const runtime = new CliContainerRuntime(command, 'win32');
        await expect(runtime.installed('docker')).resolves.toBe(false);
        await expect(runtime.connect('podman')).rejects.toMatchObject({ problem: 'podmanMachineMissing' });
    });

    it('pins a local Podman Machine connection and rejects non-loopback endpoints', async () => {
        const command = vi.fn<EngineCommand>();
        const machine = JSON.stringify([{ Name: 'machine' }]);
        const connection = (host: string) =>
            JSON.stringify([
                {
                    Name: 'machine',
                    URI: `ssh://user@${host}:2022/run/podman.sock`,
                    Identity: 'identity',
                    Default: true,
                },
            ]);
        command
            .mockResolvedValueOnce(machine)
            .mockResolvedValueOnce(connection('127.0.0.1'))
            .mockResolvedValueOnce(
                JSON.stringify({
                    host: { os: 'linux', hostname: 'machine', security: { rootless: true } },
                    store: { graphRoot: '/test/engine' },
                    version: { Version: '5.7.0' },
                }),
            )
            .mockResolvedValueOnce('')
            .mockResolvedValueOnce(machine)
            .mockResolvedValueOnce(connection('192.0.2.1'));
        const runtime = new CliContainerRuntime(command, 'win32');
        const session = await runtime.connect('podman');
        await session.pull(new AbortController().signal);
        expect(command.mock.calls[3]?.[1].slice(0, 5)).toEqual([
            '--remote=true',
            '--url',
            'ssh://user@127.0.0.1:2022/run/podman.sock',
            '--identity',
            'identity',
        ]);
        await expect(runtime.connect('podman')).rejects.toMatchObject({ problem: 'podmanUnsupported' });
    });

    it('does not change a volume with the managed name but incorrect labels', async () => {
        vi.stubEnv('DOCKER_HOST', 'unix:///var/run/docker.sock');
        vi.stubEnv('DOCKER_CONTEXT', '');
        const command = vi
            .fn<EngineCommand>()
            .mockResolvedValueOnce('linux 28.1.0 engine')
            .mockResolvedValueOnce('vscode-cosmosdb-instance-data')
            .mockResolvedValueOnce(JSON.stringify([{ Name: 'vscode-cosmosdb-instance-data', Labels: {} }]));
        const session = await new CliContainerRuntime(command).connect('docker');
        await expect(session.removeVolume(lease)).rejects.toMatchObject({ problem: 'ownership' });
        expect(command.mock.calls.map(([, args]) => args.slice(2, 4))).toEqual([
            ['info', '--format'],
            ['volume', 'ls'],
            ['volume', 'inspect'],
        ]);
    });

    it.each([
        ['docker', '/socket:uid=1000,gid=1000,mode=0755'],
        ['podman', '/socket:mode=1777,notmpcopyup'],
    ] as const)('creates a writable, ephemeral socket directory with %s mount options', async (engine, socketMount) => {
        vi.stubEnv('DOCKER_HOST', 'unix:///var/run/docker.sock');
        vi.stubEnv('DOCKER_CONTEXT', '');
        const command = vi
            .fn<EngineCommand>()
            .mockResolvedValueOnce(
                engine === 'docker'
                    ? 'linux 28.1.0 engine'
                    : JSON.stringify({
                          host: { os: 'linux', hostname: 'local', security: { rootless: true } },
                          store: { graphRoot: '/test/engine' },
                          version: { Version: '4.9.5' },
                      }),
            )
            .mockResolvedValueOnce('vscode-cosmosdb-instance-data')
            .mockResolvedValueOnce(
                JSON.stringify([
                    {
                        Name: 'vscode-cosmosdb-instance-data',
                        Labels: {
                            'com.microsoft.vscode-cosmosdb.emulator': lease.id,
                            'com.microsoft.vscode-cosmosdb.emulator.operation': lease.volumeOperation,
                        },
                    },
                ]),
            )
            .mockResolvedValueOnce('emulator-container');
        const session = await new CliContainerRuntime(command, 'linux').connect(engine);
        await session.createContainer({ ...lease, engine });
        const args = command.mock.lastCall?.[1] ?? [];
        const mountIndex = args.indexOf('--tmpfs');
        expect(mountIndex).toBeGreaterThan(-1);
        expect(args[mountIndex + 1]).toBe(socketMount);
    });

    it('redacts keys, authentication headers and passwords before exposing logs', () => {
        expect(
            maskEmulatorLogs(`Ready\n${wellKnownEmulatorPassword}\nAuthorization: sensitive\n"password":"secret"`),
        ).toBe('Ready\n[REDACTED]\n[REDACTED]\n"[REDACTED]');
    });
});
