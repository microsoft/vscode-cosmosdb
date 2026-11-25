/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, getExperienceFromApi } from '../../../../AzureDBExperiences';
import { managedEmulatorName } from '../../../../services/managedEmulator/managedEmulatorExtension';
import { type EmulatorInstance } from '../../../../services/managedEmulator/ManagedEmulatorService';
import { managedStorageId, type EmulatorStatus } from '../../../../services/managedEmulator/model';
import { makeFilterable } from '../../../mixins/Filterable';
import { makeSortable } from '../../../mixins/Sortable';
import { NoSqlAccountAttachedResourceItem } from '../../../nosql/NoSqlAccountAttachedResourceItem';
import { type TreeElement } from '../../../TreeElement';
import { type TreeElementWithContextValue } from '../../../TreeElementWithContextValue';

function statusLabel(status: EmulatorStatus): string {
    switch (status) {
        case 'running':
            return l10n.t('Running');
        case 'stopped':
            return l10n.t('Stopped');
        case 'missing':
            return l10n.t('Container missing');
        case 'waiting':
            return l10n.t('Waiting for readiness');
        case 'recovery':
            return l10n.t('Cleanup pending');
        case 'unavailable':
            return l10n.t('Unavailable');
        case 'busy':
            return l10n.t('Operation in progress');
    }
}

export function setupEmulatorItem(parentId: string): TreeElement {
    const id = `${parentId}/setupManaged`;
    const label = l10n.t('Set up Azure Cosmos DB Emulator');
    return {
        id,
        getTreeItem: () => ({
            id,
            label,
            iconPath: new vscode.ThemeIcon('rocket'),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: { command: 'cosmosDB.emulator.setup', title: label },
        }),
    };
}

export function createManagedEmulatorItem(
    parentId: string,
    instance: EmulatorInstance,
    connectionString?: string,
    error?: string,
): TreeElement {
    const storageId = managedStorageId(instance.id);
    const id = `${parentId}/${storageId}`;
    const name = managedEmulatorName();
    const experience = getExperienceFromApi(API.Core);
    if (instance.status === 'running' && experience && connectionString && instance.certificate) {
        return makeFilterable(
            makeSortable(
                new ManagedNoSqlItem(
                    {
                        id,
                        storageId,
                        name,
                        isEmulator: true,
                        managedEmulator: true,
                        managedEmulatorCertificate: instance.certificate,
                        connectionString,
                    },
                    experience,
                    instance.id,
                ),
            ),
        );
    }
    const presentation = instance.status === 'running' ? 'disconnected' : instance.status;
    const description = presentation === 'disconnected' ? l10n.t('Connection missing') : statusLabel(instance.status);
    const contextValue = `managedEmulator.${presentation}`;
    const item: TreeElement & TreeElementWithContextValue & { managedEmulatorId: string } = {
        id,
        contextValue,
        managedEmulatorId: instance.id,
        getTreeItem: () => ({
            id,
            contextValue,
            label: name,
            description,
            tooltip: error ?? description,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            iconPath: new vscode.ThemeIcon('plug'),
            ...(instance.status === 'waiting'
                ? {
                      command: { command: 'cosmosDB.emulator.setup', title: l10n.t('Wait longer') },
                  }
                : {}),
        }),
    };
    return item;
}

class ManagedNoSqlItem extends NoSqlAccountAttachedResourceItem {
    public constructor(
        ...[account, experience, id]: [...ConstructorParameters<typeof NoSqlAccountAttachedResourceItem>, string]
    ) {
        super(account, experience);
        this.managedEmulatorId = id;
    }

    public readonly managedEmulatorId: string;

    public override getTreeItem(): vscode.TreeItem {
        const item = super.getTreeItem();
        item.contextValue = `${item.contextValue ?? ''} managedEmulator.running`;
        item.description = statusLabel('running');
        return item;
    }
}
