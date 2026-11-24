/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from '@azure/cosmos';
import { execFile } from 'child_process';
import { mkdtemp, rmdir } from 'fs/promises';
import { Agent } from 'https';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { expect, it } from 'vitest';
import { wellKnownEmulatorPassword } from '../../cosmosdb/cosmosdb-shared-constants';
import { CliContainerRuntime } from './DockerRuntime';
import { FileEmulatorLeaseStore } from './EmulatorLeaseStore';
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
    const agent = new Agent({ rejectUnauthorized: false });
    const client = new CosmosClient({
        endpoint: emulatorEndpoint(ports),
        key: wellKnownEmulatorPassword,
        agent,
        connectionPolicy: { enableEndpointDiscovery: false },
    });

    try {
        await service.provision(engine, ports, signal, () => {});
        const { database } = await client.databases.create({ id: 'managed-test' });
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
        expect((await database.read()).resource?.id).toBe('managed-test');
        await session.removeContainer(lease);
        expect((await reloaded.reconcile())?.status).toBe('missing');
        await reloaded.act(instance.id, 'start', signal);
        expect((await database.read()).resource?.id).toBe('managed-test');
        expect(await reloaded.reconcile()).toMatchObject({ id: instance.id, status: 'running' });
    } finally {
        client.dispose();
        agent.destroy();
        const lease = await store.read();
        if (lease) await service.act(lease.id, 'delete', signal);
        await rmdir(directory);
    }
});
