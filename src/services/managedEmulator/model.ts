/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

export const emulatorImage =
    'mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator:vnext-EN20260907@sha256:2db1f9e74c506bcf6fc347aa937aea1c00fa756061296a5a9efba530ce86ec02';
export const loopback = '127.0.0.1';
export const defaultPorts = { endpoint: 8081, explorer: 1234 };
export type EmulatorPorts = typeof defaultPorts;
export const containerEngines = ['docker', 'podman'] as const;
export type ContainerEngine = (typeof containerEngines)[number];
export const stages = ['docker', 'ports', 'image', 'volume', 'container', 'readiness', 'connection'] as const;
export type SetupStage = (typeof stages)[number];
export type EmulatorStatus = 'running' | 'stopped' | 'missing' | 'waiting' | 'recovery' | 'unavailable' | 'busy';
export type EmulatorAction = 'start' | 'stop' | 'restart' | 'logs' | 'reconnect' | 'delete';
export type EmulatorProblem =
    | 'dockerMissing'
    | 'dockerStopped'
    | 'dockerPermissions'
    | 'dockerUnsupported'
    | 'dockerRemote'
    | 'dockerChanged'
    | 'dockerOperation'
    | 'podmanMissing'
    | 'podmanStopped'
    | 'podmanMachineMissing'
    | 'podmanUnsupported'
    | 'invalidPorts'
    | 'portConflict'
    | 'ownership'
    | 'busy'
    | 'storage'
    | 'existing'
    | 'missing'
    | 'readiness'
    | 'cancelled';

export class EmulatorError extends Error {
    public constructor(public readonly problem: EmulatorProblem) {
        super(problem);
    }
}

export function describeEmulatorError(error: unknown): string {
    switch (error instanceof EmulatorError ? error.problem : 'storage') {
        case 'dockerMissing':
            return l10n.t('Install Docker and make sure the Docker CLI is available on PATH.');
        case 'dockerStopped':
            return l10n.t('Start Docker, then try again. Check that docker info succeeds.');
        case 'dockerPermissions':
            return l10n.t('The container engine denied access. Check its local socket permissions and try again.');
        case 'dockerUnsupported':
            return l10n.t('Use Docker Engine 28 or later in Linux container mode for loopback-only publishing.');
        case 'dockerRemote':
            return l10n.t('Select a local Docker context that uses a Unix socket or Windows named pipe.');
        case 'dockerChanged':
            return l10n.t('Switch to the local container engine connection that created this emulator, then refresh.');
        case 'dockerOperation':
            return l10n.t(
                'The container engine could not complete the operation. Check its status and the emulator logs if available.',
            );
        case 'podmanMissing':
            return l10n.t('Install Podman and make sure its CLI is available on PATH.');
        case 'podmanMachineMissing':
            return l10n.t('Create a Podman machine and start it, then check again.');
        case 'podmanStopped':
            return l10n.t('Start your Podman machine and check that podman info succeeds, then try again.');
        case 'podmanUnsupported':
            return l10n.t(
                'Use a local Podman engine that runs Linux containers (Podman 4.9 or later on Linux, 5 or later on Windows and macOS).',
            );
        case 'invalidPorts':
            return l10n.t('Enter two different port numbers between 1 and 65535.');
        case 'portConflict':
            return l10n.t('A requested port is in use. Choose different ports or free the ports, then try again.');
        case 'ownership':
            return l10n.t('Docker resource ownership could not be verified. No unverified resource was changed.');
        case 'busy':
            return l10n.t('An emulator operation is already in progress. Wait for it to finish and try again.');
        case 'existing':
            return l10n.t('An emulator is already set up. Use its actions under Local Emulators.');
        case 'missing':
            return l10n.t(
                'The managed emulator container is missing. Use Start to recreate it without deleting its data.',
            );
        case 'readiness':
            return l10n.t('The Cosmos DB SDK could not connect yet. Check the logs, or select Wait longer.');
        case 'cancelled':
            return l10n.t('Emulator setup was cancelled.');
        case 'storage':
            return l10n.t('Could not read or save the managed emulator state or connection. Try again.');
    }
}

export interface EmulatorLease {
    readonly id: string;
    readonly volumeOperation: string;
    readonly containerOperation: string;
    readonly engineId: string;
    readonly engine: ContainerEngine;
    readonly ports: EmulatorPorts;
    readonly phase: 'provisioning' | 'waiting' | 'ready' | 'rollback' | 'deleting';
    readonly newVolume: boolean;
    readonly stage: SetupStage;
}

export interface SetupProgress {
    readonly stage: SetupStage;
    readonly state: 'active' | 'waiting' | 'done';
}

export function validPorts(value: EmulatorPorts): boolean {
    return (
        Number.isInteger(value.endpoint) &&
        value.endpoint >= 1 &&
        value.endpoint <= 65535 &&
        Number.isInteger(value.explorer) &&
        value.explorer >= 1 &&
        value.explorer <= 65535 &&
        value.endpoint !== value.explorer
    );
}

export function emulatorEndpoint(ports: EmulatorPorts): string {
    return `https://${loopback}:${ports.endpoint}/`;
}

export function managedStorageId(id: string): string {
    return `managed-${id}`;
}
