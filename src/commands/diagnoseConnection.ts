/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API } from '../AzureDBExperiences';
import { ext } from '../extensionVariables';
import { NoSqlAccountAttachedResourceItem } from '../tree/nosql/NoSqlAccountAttachedResourceItem';
import { NoSqlAccountResourceItem } from '../tree/nosql/NoSqlAccountResourceItem';
import { LocalCoreEmulatorsItem } from '../tree/workspace-view/cosmosdb/LocalEmulators/LocalCoreEmulatorsItem';
import { pickAppResource } from '../utils/pickItem/pickAppResource';

async function selectConnection(context: IActionContext) {
    const azure = l10n.t('Azure account');
    const saved = l10n.t('Saved connection or local emulator');
    const source = await vscode.window.showQuickPick([azure, saved], {
        placeHolder: l10n.t('Select a connection source to diagnose'),
    });
    if (source === azure) {
        return pickAppResource<NoSqlAccountResourceItem>(context, { type: AzExtResourceType.AzureCosmosDb });
    }
    if (source !== saved) return undefined;

    const children = (await ext.cosmosDBWorkspaceBranchDataResource?.getChildren()) ?? [];
    const emulatorGroup = children.find((item) => item instanceof LocalCoreEmulatorsItem);
    const emulators = (await emulatorGroup?.getChildren()) ?? [];
    const accounts = [...children, ...emulators]
        .filter(
            (item): item is NoSqlAccountAttachedResourceItem =>
                item instanceof NoSqlAccountAttachedResourceItem && item.experience.api === API.Core,
        )
        .map((node) => ({
            label: node.account.name,
            description: node.account.isEmulator ? l10n.t('Local emulator') : l10n.t('Saved connection'),
            node,
        }));
    if (!accounts.length) {
        void vscode.window.showInformationMessage(
            l10n.t('There are no saved Cosmos DB for NoSQL connections to diagnose.'),
        );
        return undefined;
    }
    return (
        await vscode.window.showQuickPick(accounts, {
            placeHolder: l10n.t('Select a connection to diagnose'),
        })
    )?.node;
}

export async function diagnoseConnection(context: IActionContext, node?: unknown): Promise<void> {
    context.telemetry.maskEntireErrorMessage = true;
    const selected = node ?? (await selectConnection(context));
    if (!selected) return;
    if (
        !(selected instanceof NoSqlAccountResourceItem || selected instanceof NoSqlAccountAttachedResourceItem) ||
        selected.experience.api !== API.Core
    ) {
        void vscode.window.showInformationMessage(
            l10n.t('Connection diagnostics are available for Cosmos DB for NoSQL accounts.'),
        );
        return;
    }
    const { ConnectionDiagnosticsTab } = await import('../panels/ConnectionDiagnosticsTab');
    context.valuesToMask.push(selected.account.id, selected.account.name);
    if (selected instanceof NoSqlAccountResourceItem) {
        ConnectionDiagnosticsTab.render({ kind: 'azure', account: selected.account });
    } else {
        context.valuesToMask.push(selected.account.connectionString);
        const kind = selected.account.isEmulator ? 'emulator' : 'attached';
        ConnectionDiagnosticsTab.render({ kind, account: selected.account });
    }
}
