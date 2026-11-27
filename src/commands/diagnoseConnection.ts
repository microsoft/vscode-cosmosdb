/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type AccountDiagnosticsTarget } from '../connectionDiagnostics/target';
import { ext } from '../extensionVariables';
import { ConnectionDiagnosticsTab } from '../panels/ConnectionDiagnosticsTab';
import { getConnectionDiagnosticsTarget } from '../tree/cosmosdb/connectionDiagnosticsTarget';
import { type TreeElement } from '../tree/TreeElement';
import { isTreeElementWithContextValue } from '../tree/TreeElementWithContextValue';
import { LocalCoreEmulatorsItem } from '../tree/workspace-view/cosmosdb/LocalEmulators/LocalCoreEmulatorsItem';
import { pickAppResource } from '../utils/pickItem/pickAppResource';

async function selectConnection(context: IActionContext): Promise<AccountDiagnosticsTarget | undefined> {
    const source = await vscode.window.showQuickPick(
        [
            { label: l10n.t('Azure account'), source: 'azure' },
            { label: l10n.t('Saved connection or local emulator'), source: 'saved' },
        ],
        { placeHolder: l10n.t('Select a connection source to diagnose') },
    );
    if (source?.source === 'azure') {
        const node = await pickAppResource<TreeElement>(context, { type: AzExtResourceType.AzureCosmosDb });
        const target = getConnectionDiagnosticsTarget(node);
        if (node && !target) showUnsupportedTarget();
        return target;
    }
    if (source?.source !== 'saved') return undefined;

    const children = (await ext.cosmosDBWorkspaceBranchDataResource?.getChildren()) ?? [];
    const emulatorGroup = children.find(
        (item) =>
            isTreeElementWithContextValue(item) &&
            item.contextValue.split(';').includes(LocalCoreEmulatorsItem.groupContextValue),
    );
    const emulators = (await emulatorGroup?.getChildren?.()) ?? [];
    const accounts = [...children, ...emulators]
        .map(getConnectionDiagnosticsTarget)
        .filter((target) => target !== undefined && target.kind !== 'azure')
        .map((target) => ({
            label: target.account.name,
            description: target.kind === 'emulator' ? l10n.t('Local emulator') : l10n.t('Saved connection'),
            target,
        }));
    if (!accounts.length) {
        void vscode.window.showInformationMessage(l10n.t('There are no saved Cosmos DB connections to diagnose.'));
        return undefined;
    }
    return (
        await vscode.window.showQuickPick(accounts, {
            placeHolder: l10n.t('Select a connection to diagnose'),
        })
    )?.target;
}

function showUnsupportedTarget(): void {
    void vscode.window.showInformationMessage(l10n.t('Select a Cosmos DB account or saved connection to diagnose.'));
}

export async function diagnoseConnection(context: IActionContext, node?: unknown): Promise<void> {
    context.telemetry.maskEntireErrorMessage = true;
    const fromPalette = node === undefined || node === null;
    const target = fromPalette ? await selectConnection(context) : getConnectionDiagnosticsTarget(node);
    if (!target) {
        if (!fromPalette) showUnsupportedTarget();
        return;
    }
    context.valuesToMask.push(target.account.id, target.account.name);
    if (target.kind !== 'azure' && target.account.connectionString) {
        context.valuesToMask.push(target.account.connectionString);
    }
    ConnectionDiagnosticsTab.render(target);
}
