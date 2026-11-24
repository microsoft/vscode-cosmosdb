/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import { Agent } from 'https';
import { setTimeout } from 'timers/promises';
import * as vscode from 'vscode';
import { API } from '../../AzureDBExperiences';
import { wellKnownEmulatorPassword } from '../../cosmosdb/cosmosdb-shared-constants';
import { ext } from '../../extensionVariables';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { revealAttachedAccounts } from '../../utils/revealAttachedAccounts';
import { StorageNames, StorageService } from '../StorageService';
import { CliContainerRuntime } from './DockerRuntime';
import { FileEmulatorLeaseStore } from './EmulatorLeaseStore';
import { ManagedEmulatorService, type EmulatorInstance } from './ManagedEmulatorService';
import { describeEmulatorError, emulatorEndpoint, managedStorageId, type EmulatorPorts } from './model';

export const localEmulatorsId = `${WorkspaceResourceType.AttachedAccounts}/localEmulators`;

export function managedEmulatorName(): string {
    return l10n.t('Azure Cosmos DB Emulator (NoSQL)');
}

let service: ManagedEmulatorService | undefined;

export function getManagedEmulator(): ManagedEmulatorService | undefined {
    return service;
}

export function refreshManagedEmulatorTree(): void {
    ext.cosmosDBWorkspaceBranchDataProvider.refresh();
}

export async function revealManagedEmulator(id: string): Promise<void> {
    await revealAttachedAccounts(localEmulatorsId);
    await ext.rgApiV2.resources.revealWorkspaceResource(`${localEmulatorsId}/${managedStorageId(id)}`, {
        select: true,
        focus: true,
        expand: true,
    });
}

export async function readManagedEmulator(): Promise<{ instance?: EmulatorInstance; error?: string }> {
    try {
        return { instance: await service?.reconcile() };
    } catch (error) {
        return {
            instance: error instanceof Error && 'instance' in error ? (error.instance as EmulatorInstance) : undefined,
            error: describeEmulatorError(error),
        };
    }
}

export async function probeEmulator(ports: EmulatorPorts, signal: AbortSignal): Promise<boolean> {
    const agent = new Agent({ rejectUnauthorized: false });
    const client = new CosmosClient({
        endpoint: emulatorEndpoint(ports),
        key: wellKnownEmulatorPassword,
        agent,
        connectionPolicy: { enableEndpointDiscovery: false, retryOptions: { maxRetryAttemptCount: 0 } },
    });
    try {
        while (!signal.aborted) {
            try {
                await client.getDatabaseAccount({ abortSignal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]) });
                return !signal.aborted;
            } catch {
                if (!signal.aborted) await setTimeout(1_000, undefined, { signal }).catch(() => undefined);
            }
        }
        return false;
    } finally {
        client.dispose();
        agent.destroy();
    }
}

export function activateManagedEmulator(context: vscode.ExtensionContext): void {
    const storage = StorageService.get(StorageNames.Workspace);
    const store = WorkspaceResourceType.AttachedAccounts;
    service = new ManagedEmulatorService({
        store: new FileEmulatorLeaseStore(context.globalStorageUri.fsPath),
        runtime: new CliContainerRuntime(),
        probe: probeEmulator,
        saveConnection: (lease) =>
            storage.push(store, {
                id: managedStorageId(lease.id),
                name: managedEmulatorName(),
                properties: { api: API.Core, isEmulator: true, managedEmulator: true },
                secrets: [`AccountEndpoint=${emulatorEndpoint(lease.ports)};AccountKey=${wellKnownEmulatorPassword};`],
            }),
        deleteConnection: (lease) => storage.delete(store, managedStorageId(lease.id)),
    });
    context.subscriptions.push(
        new vscode.Disposable(() => {
            service = undefined;
        }),
    );
    void readManagedEmulator().then(({ error }) => {
        if (error) ext.outputChannel.warn(error);
    });
}
