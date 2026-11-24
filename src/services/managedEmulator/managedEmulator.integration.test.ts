/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from '@azure/cosmos';
import { execFile } from 'child_process';
import { mkdtemp, rmdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { expect, it } from 'vitest';
import { wellKnownEmulatorPassword } from '../../cosmosdb/cosmosdb-shared-constants';
import { CliContainerRuntime } from './DockerRuntime';
import { FileEmulatorLeaseStore } from './EmulatorLeaseStore';
import { createManagedEmulatorAgent } from './emulatorTls';
import { probeEmulator } from './managedEmulatorExtension';
import { ManagedEmulatorService } from './ManagedEmulatorService';
import { emulatorEndpoint } from './model';

const selected = process.env.COSMOSDB_MANAGED_TEST_ENGINE;
const engine = selected === 'docker' || selected === 'podman' ? selected : undefined;
const run = promisify(execFile);

it.skipIf(!engine)('preserves NoSQL data across reload and managed recreation', { timeout: 25 * 60_000 }, async () => {
    if (!engine) throw new Error('Select docker or podman');
    const directory = await mkdtemp(path.join(tmpdir(), 'cosmosdb-managed-emulator-'));
    const store = new FileEmulatorLeaseStore(directory);
    const runtime = new CliContainerRuntime();
    const ports = { endpoint: 18081, explorer: 11234 };
    const signal = new AbortController().signal;
    const deps = {
        store,
        runtime,
        probe: probeEmulator,
        saveConnection: async () => {},
        deleteConnection: async () => {},
    };
    const service = new ManagedEmulatorService(deps);
    const withClient = async <T>(state: ManagedEmulatorService, action: (client: CosmosClient) => Promise<T>) => {
        const instance = await state.reconcile(true);
        const endpoint = emulatorEndpoint(ports);
        const agent = createManagedEmulatorAgent(endpoint, instance?.certificate);
        const client = new CosmosClient({
            endpoint,
            key: wellKnownEmulatorPassword,
            agent,
            connectionPolicy: { enableEndpointDiscovery: false },
        });
        try {
            return await action(client);
        } finally {
            client.dispose();
            agent.destroy();
        }
    };

    try {
        await service.provision(engine, ports, signal, () => {});
        await withClient(service, (client) => client.databases.create({ id: 'managed-test' }));
        const instance = await service.reconcile();
        if (!instance) throw new Error('No managed instance was persisted');
        const lease = await store.read();
        if (!lease) throw new Error('Lost emulator lease');
        const session = await runtime.connect(engine);
        const container = await session.container(lease);
        if (!container) throw new Error('No owned container was found');
        for (const [containerPort, hostPort] of [
            [8081, ports.endpoint],
            [1234, ports.explorer],
        ]) {
            const { stdout } = await run(engine, ['port', container.id, `${containerPort}/tcp`]);
            expect(stdout.trim()).toBe(`127.0.0.1:${hostPort}`);
        }
        const reloaded = new ManagedEmulatorService(deps);
        await reloaded.act(instance.id, 'stop', signal);
        expect((await reloaded.reconcile())?.status).toBe('stopped');
        await reloaded.act(instance.id, 'start', signal);
        await reloaded.act(instance.id, 'restart', signal);
        expect((await withClient(reloaded, (client) => client.database('managed-test').read())).resource?.id).toBe(
            'managed-test',
        );
        await session.removeContainer(lease);
        expect((await reloaded.reconcile())?.status).toBe('missing');
        await reloaded.act(instance.id, 'start', signal);
        expect((await withClient(reloaded, (client) => client.database('managed-test').read())).resource?.id).toBe(
            'managed-test',
        );
        expect(await reloaded.reconcile()).toMatchObject({ id: instance.id, status: 'running' });
    } finally {
        const lease = await store.read();
        if (lease) await service.act(lease.id, 'delete', signal);
        await rmdir(directory);
    }
});
