/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { type ContainerRuntime, type ContainerSession } from './DockerRuntime';
import { type EmulatorLeaseStore } from './EmulatorLeaseStore';
import {
    EmulatorError,
    type ContainerEngine,
    type EmulatorAction,
    type EmulatorLease,
    type EmulatorPorts,
    type EmulatorStatus,
    type SetupProgress,
    type SetupStage,
    validPorts,
} from './model';

export interface ManagedEmulatorDependencies {
    readonly store: EmulatorLeaseStore;
    readonly runtime: ContainerRuntime;
    readonly probe: (ports: EmulatorPorts, signal: AbortSignal) => Promise<boolean>;
    readonly saveConnection: (lease: EmulatorLease) => Promise<void>;
    readonly deleteConnection: (lease: EmulatorLease) => Promise<void>;
    readonly readyTimeoutMs?: number;
}

export interface EmulatorInstance {
    readonly id: string;
    readonly status: EmulatorStatus;
    readonly ports: EmulatorPorts;
    readonly stage: SetupStage;
    readonly engine: ContainerEngine;
    readonly error?: string;
}

type Report = (progress: SetupProgress) => void;
const noReport: Report = () => undefined;

function checkCancellation(signal: AbortSignal): void {
    if (signal.aborted) throw new EmulatorError('cancelled');
}

export class ManagedEmulatorService {
    public constructor(private readonly deps: ManagedEmulatorDependencies) {}

    public async availableEngines(): Promise<ContainerEngine[]> {
        const engines: ContainerEngine[] = ['docker', 'podman'];
        const available = await Promise.all(engines.map((engine) => this.deps.runtime.installed(engine)));
        return engines.filter((_, index) => available[index]);
    }

    public async reconcile(): Promise<EmulatorInstance | undefined> {
        const lease = await this.deps.store.read();
        if (!lease) return undefined;
        const view = (status: EmulatorStatus): EmulatorInstance => ({
            id: lease.id,
            ports: lease.ports,
            stage: lease.stage,
            status,
            engine: lease.engine,
        });
        try {
            return await this.deps.store.exclusive(async (assertExclusive) => {
                const current = await this.deps.store.read();
                if (!current) return undefined;
                if (current.id !== lease.id || current.phase !== lease.phase || current.stage !== lease.stage) {
                    return {
                        id: current.id,
                        ports: current.ports,
                        stage: current.stage,
                        status: 'busy',
                        engine: current.engine,
                    };
                }

                const session = await this.connect(lease);
                if (lease.phase === 'provisioning' || lease.phase === 'rollback' || lease.phase === 'deleting') {
                    await this.clean(session, lease, assertExclusive);
                    const remaining = await this.deps.store.read();
                    return remaining ? view('missing') : undefined;
                }
                const container = await session.container(lease);
                if (!container) return view('missing');
                if (!container.running) return view('stopped');
                await session.requireVolume(lease);
                return view(lease.phase === 'waiting' ? 'waiting' : 'running');
            });
        } catch (error) {
            if (error instanceof EmulatorError && error.problem === 'busy') return view('busy');
            const recovery = lease.phase === 'provisioning' || lease.phase === 'rollback' || lease.phase === 'deleting';
            throw Object.assign(error instanceof Error ? error : new EmulatorError('storage'), {
                instance: view(recovery ? 'recovery' : 'unavailable'),
            });
        }
    }

    public async provision(
        engine: ContainerEngine,
        ports: EmulatorPorts,
        signal: AbortSignal,
        report: Report,
    ): Promise<void> {
        await this.deps.store.exclusive(async (assertExclusive) => {
            if (await this.deps.store.read()) throw new EmulatorError('existing');
            if (!validPorts(ports)) throw new EmulatorError('invalidPorts');
            report({ stage: 'docker', state: 'active' });
            const session = await this.deps.runtime.connect(engine, signal);
            const lease: EmulatorLease = {
                id: randomUUID(),
                volumeOperation: randomUUID(),
                containerOperation: randomUUID(),
                engine,
                engineId: session.engineId,
                ports,
                phase: 'provisioning',
                newVolume: true,
                stage: 'ports',
            };
            await this.create(session, lease, signal, report, assertExclusive);
        });
    }

    public async act(
        id: string,
        action: EmulatorAction,
        signal: AbortSignal,
        report: Report = noReport,
    ): Promise<string | undefined> {
        return this.deps.store.exclusive(async (assertExclusive): Promise<string | undefined> => {
            const lease = await this.deps.store.read();
            if (!lease || id !== lease.id) throw new EmulatorError('missing');
            checkCancellation(signal);
            const session = await this.connect(lease, signal);
            if (action === 'logs') return session.logs(lease);
            assertExclusive();
            if (lease.phase === 'provisioning' || lease.phase === 'rollback' || lease.phase === 'deleting') {
                await this.clean(session, lease, assertExclusive);
                if (action === 'delete' && !(await this.deps.store.read())) return undefined;
                throw new EmulatorError('missing');
            }
            if (action === 'delete') {
                await this.deps.store.write({ ...lease, phase: 'deleting' });
                await this.clean(session, { ...lease, phase: 'deleting' }, assertExclusive);
                return undefined;
            }
            if (action === 'stop') {
                await session.stop(lease);
                return undefined;
            }
            const container = await session.container(lease);
            if (!container) {
                if (action === 'reconnect') throw new EmulatorError('missing');
                await this.create(
                    session,
                    {
                        ...lease,
                        phase: 'provisioning',
                        newVolume: false,
                        containerOperation: randomUUID(),
                        stage: 'ports',
                    },
                    signal,
                    report,
                    assertExclusive,
                );
                return undefined;
            }
            if (action === 'reconnect' && !container.running) throw new EmulatorError('missing');
            await session.requireVolume(lease);
            if (!container.running || action === 'restart') {
                assertExclusive();
                if (action === 'restart' && container.running) await session.stop(lease);
                await session.checkPorts(lease.ports, signal);
                checkCancellation(signal);
                assertExclusive();
                await session.start(lease);
            }
            await this.wait(session, lease, signal, report, assertExclusive);
            return undefined;
        });
    }

    private async connect(lease: EmulatorLease, signal?: AbortSignal): Promise<ContainerSession> {
        const session = await this.deps.runtime.connect(lease.engine, signal);
        if (session.engineId !== lease.engineId) throw new EmulatorError('dockerChanged');
        return session;
    }

    private async create(
        session: ContainerSession,
        initial: EmulatorLease,
        signal: AbortSignal,
        report: Report,
        assertExclusive: () => void,
    ): Promise<void> {
        let lease = initial;
        const stage = async (next: SetupStage) => {
            checkCancellation(signal);
            assertExclusive();
            lease = { ...lease, stage: next };
            await this.deps.store.write(lease);
            report({ stage: next, state: 'active' });
        };
        // Commit the ownership IDs before the first possible Docker mutation.
        await stage('ports');
        try {
            await session.checkPorts(lease.ports, signal);
            await stage('image');
            await session.pull(signal);
            await stage('volume');
            if (lease.newVolume) await session.createVolume(lease);
            else await session.requireVolume(lease);
            await stage('container');
            await session.createContainer(lease);
            checkCancellation(signal);
            assertExclusive();
            await session.start(lease);
            await this.wait(session, lease, signal, report, assertExclusive);
        } catch (error) {
            if (error instanceof EmulatorError && error.problem === 'readiness') throw error;
            assertExclusive();
            const rollback: EmulatorLease = { ...lease, phase: 'rollback' };
            await this.deps.store.write(rollback);
            await this.clean(session, rollback, assertExclusive);
            throw error;
        }
    }

    private async wait(
        session: ContainerSession,
        lease: EmulatorLease,
        signal: AbortSignal,
        report: Report,
        assertExclusive: () => void,
    ): Promise<void> {
        assertExclusive();
        const original = await session.container(lease);
        if (!original?.running) throw new EmulatorError('missing');
        await this.deps.store.write({ ...lease, phase: 'waiting', stage: 'readiness' });
        report({ stage: 'readiness', state: 'active' });
        const ready = await this.deps.probe(
            lease.ports,
            AbortSignal.any([signal, AbortSignal.timeout(this.deps.readyTimeoutMs ?? 180_000)]),
        );
        checkCancellation(signal);
        if (!ready) {
            report({ stage: 'readiness', state: 'waiting' });
            throw new EmulatorError('readiness');
        }
        assertExclusive();
        const verified = await session.container(lease);
        if (!verified?.running || verified.id !== original.id) throw new EmulatorError('missing');
        await this.deps.store.write({ ...lease, phase: 'waiting', stage: 'connection' });
        report({ stage: 'connection', state: 'active' });
        await this.deps.saveConnection(lease);
        checkCancellation(signal);
        assertExclusive();
        await this.deps.store.write({ ...lease, phase: 'ready', stage: 'connection', newVolume: false });
        report({ stage: 'connection', state: 'done' });
    }

    private async clean(session: ContainerSession, lease: EmulatorLease, assertExclusive: () => void): Promise<void> {
        assertExclusive();
        const mutated = lease.phase === 'deleting' || !['docker', 'ports', 'image'].includes(lease.stage);
        if (mutated) await session.removeContainer(lease);
        assertExclusive();
        if (mutated && (lease.newVolume || lease.phase === 'deleting')) await session.removeVolume(lease);
        assertExclusive();
        if (lease.newVolume || lease.phase === 'deleting') {
            await this.deps.deleteConnection(lease);
            await this.deps.store.write(undefined);
        } else {
            await this.deps.store.write({ ...lease, phase: 'ready', stage: 'connection' });
        }
    }
}
