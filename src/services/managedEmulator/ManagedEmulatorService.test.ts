/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { type ContainerSession } from './DockerRuntime';
import { ManagedEmulatorService } from './ManagedEmulatorService';
import { defaultPorts, EmulatorError, type EmulatorLease } from './model';

function fixture() {
    let lease: EmulatorLease | undefined;
    const calls: string[] = [];
    const session = {
        engineId: 'test-engine',
        checkPorts: vi.fn(async () => {
            calls.push('ports');
        }),
        pull: vi.fn(async () => {
            calls.push('pull');
        }),
        createVolume: vi.fn(async () => {
            calls.push('volume');
        }),
        requireVolume: vi.fn(async () => undefined),
        createContainer: vi.fn(async () => {
            calls.push('create');
        }),
        container: vi.fn<ContainerSession['container']>().mockResolvedValue({ id: 'container-id', running: true }),
        certificate: vi.fn(async () => 'test-certificate'),
        start: vi.fn(async () => {
            calls.push('start');
        }),
        stop: vi.fn(async () => undefined),
        removeContainer: vi.fn(async () => {
            calls.push('removeContainer');
        }),
        removeVolume: vi.fn(async () => {
            calls.push('removeVolume');
        }),
        logs: vi.fn(async () => ''),
    } satisfies ContainerSession;
    const connect = vi.fn(async () => session);
    const probe = vi.fn(async () => true);
    const saveConnection = vi.fn(async () => {
        calls.push('save');
    });
    const deleteConnection = vi.fn(async () => {
        calls.push('deleteConnection');
    });
    const deps = {
        runtime: { connect, installed: vi.fn(async () => true) },
        store: {
            read: async () => lease,
            write: async (value: EmulatorLease | undefined) => {
                lease = value;
            },
            exclusive: async <T>(fn: (assert: () => void) => Promise<T>) => fn(() => undefined),
        },
        probe,
        saveConnection,
        deleteConnection,
    };
    const service = new ManagedEmulatorService(deps);
    const controller = new AbortController();
    const report = vi.fn();
    return {
        calls,
        session,
        deps,
        service,
        probe,
        report,
        controller,
        provision: () => service.provision('podman', defaultPorts, controller.signal, report),
    };
}

describe('ManagedEmulatorService', () => {
    it('checks ports before pulling and commits a connection only after SDK readiness', async () => {
        const test = fixture();
        await test.provision();
        expect(test.calls).toEqual(['ports', 'pull', 'volume', 'create', 'start', 'save']);
        expect(test.deps.runtime.connect).toHaveBeenCalledWith('podman', test.controller.signal);
        expect(test.probe).toHaveBeenCalledOnce();
        expect(test.report).toHaveBeenLastCalledWith({ stage: 'connection', state: 'done' });
    });

    it('reuses the same container and record when waiting again after a reload', async () => {
        const test = fixture();
        test.probe.mockResolvedValueOnce(false);
        await expect(test.provision()).rejects.toMatchObject({ problem: 'readiness' });
        const reloaded = new ManagedEmulatorService(test.deps);
        const pending = await reloaded.reconcile();
        expect(pending).toMatchObject({ status: 'waiting', engine: 'podman' });
        await reloaded.act(pending!.id, 'reconnect', test.controller.signal);
        expect(test.session.createContainer).toHaveBeenCalledOnce();
        expect(test.session.pull).toHaveBeenCalledOnce();
        expect(await reloaded.reconcile()).toMatchObject({ id: pending!.id, status: 'running' });
    });

    it('returns the current container certificate only to callers that request it', async () => {
        const test = fixture();
        await test.provision();
        expect(await test.service.reconcile()).not.toHaveProperty('certificate');
        expect(test.session.certificate).not.toHaveBeenCalled();
        expect(await test.service.reconcile(true)).toMatchObject({ certificate: 'test-certificate' });
        test.session.certificate.mockResolvedValueOnce('rotated-certificate');
        expect(await test.service.reconcile(true)).toMatchObject({ certificate: 'rotated-certificate' });
    });

    it('does not pull or remove Docker resources if a port conflicts', async () => {
        const test = fixture();
        test.session.checkPorts.mockRejectedValueOnce(new EmulatorError('portConflict'));
        await expect(test.provision()).rejects.toMatchObject({ problem: 'portConflict' });
        expect(test.calls).toEqual(['deleteConnection']);
        expect(await test.deps.store.read()).toBeUndefined();
    });

    it('rolls back a cancelled new setup while preserving a prior volume on failed recreation', async () => {
        const cancelled = fixture();
        cancelled.probe.mockImplementationOnce(async () => {
            cancelled.controller.abort();
            return false;
        });
        await expect(cancelled.provision()).rejects.toMatchObject({ problem: 'cancelled' });
        expect(cancelled.calls.slice(-3)).toEqual(['removeContainer', 'removeVolume', 'deleteConnection']);

        const test = fixture();
        await test.provision();
        const ready = await test.deps.store.read();
        test.session.container.mockResolvedValueOnce(undefined);
        test.session.start.mockRejectedValueOnce(new EmulatorError('dockerOperation'));
        await expect(test.service.act(ready!.id, 'start', test.controller.signal)).rejects.toMatchObject({
            problem: 'dockerOperation',
        });
        expect(test.session.removeVolume).not.toHaveBeenCalled();
        expect(await test.deps.store.read()).toMatchObject({ id: ready!.id, volumeOperation: ready!.volumeOperation });
    });

    it('refuses to operate on a different engine even with a saved instance', async () => {
        const test = fixture();
        await test.provision();
        const saved = await test.deps.store.read();
        test.deps.runtime.connect.mockResolvedValueOnce({ ...test.session, engineId: 'different-engine' });
        await expect(test.service.act(saved!.id, 'delete', test.controller.signal)).rejects.toMatchObject({
            problem: 'dockerChanged',
        });
        expect(test.session.removeContainer).not.toHaveBeenCalled();
    });
});
