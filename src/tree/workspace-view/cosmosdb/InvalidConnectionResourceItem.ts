/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API, getExperienceFromApi } from '../../../AzureDBExperiences';
import { ext } from '../../../extensionVariables';
import { type StorageItem } from '../../../services/StorageService';
import { type TreeElement } from '../../TreeElement';

// Only structural defects are reported here. A well-formed but unsupported API is left to the caller,
// which skips it as before so accounts owned by other extensions are not flagged as broken.
export function getSavedConnectionError(item: StorageItem): string | undefined {
    const api = item.properties?.api;
    if (typeof api !== 'string' || !api.trim()) {
        return l10n.t('The saved connection is missing its API type.');
    }
    if (typeof item.name !== 'string' || !item.name.trim()) {
        return l10n.t('The saved connection is missing its name.');
    }
    if (typeof item.properties?.isEmulator !== 'boolean') {
        return l10n.t('The saved connection has an invalid emulator setting.');
    }
    if (!item.properties.isEmulator && (typeof item.secrets?.[0] !== 'string' || !item.secrets[0].trim())) {
        return l10n.t('The saved connection is missing its connection string.');
    }
    return undefined;
}

const fallbackLabel = () => l10n.t('Unnamed connection');

export class InvalidConnectionResourceItem implements TreeElement {
    public readonly id: string;
    public readonly storageId: string;
    public readonly account: { name: string };
    public readonly experience = getExperienceFromApi(API.Common);

    constructor(
        parentId: string,
        item: StorageItem,
        private readonly reason: string,
    ) {
        this.id = `${parentId}/${item.id}`;
        this.storageId = item.id;
        // Persisted records are not shape-validated, so a malformed name would otherwise reach the tree label
        // and the removal flow, which both expect a string.
        this.account = { name: typeof item.name === 'string' && item.name.trim() ? item.name : fallbackLabel() };
        ext.outputChannel.error(reason);
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            label: this.account.name,
            description: l10n.t('Invalid saved connection'),
            tooltip: this.reason + '\n' + l10n.t('Remove this connection, then attach it again.'),
            iconPath: new vscode.ThemeIcon('warning'),
            contextValue: 'treeItem.invalidConnection',
            collapsibleState: vscode.TreeItemCollapsibleState.None,
        };
    }
}
