/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { validateDatabaseName } from '../../cosmosdb/utils/validateResourceName';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { validateDatabaseNameAvailable } from './CosmosDBDatabaseNameStep';

export type DatabaseCreationChoice = { kind: 'manual'; databaseName: string } | { kind: 'dataModeler' };

type ChoiceItem = vscode.QuickPickItem & { action?: 'create' | 'dataModeler' };

/**
 * Prompts for a database name in an editable quick pick that also offers Data Modeler, so choosing the guided
 * experience does not add a step to manual creation. Quick picks have no validation message area, so name errors are
 * shown on the create item.
 */
export async function promptDatabaseNameOrDataModeler(accountInfo: AccountInfo): Promise<DatabaseCreationChoice> {
    const quickPick = vscode.window.createQuickPick<ChoiceItem>();
    const disposables: vscode.Disposable[] = [quickPick];
    // Labels are empty because VS Code always matches the typed name against them; that would highlight and re-sort
    // these items. Descriptions are not matched, so the items keep their order without highlights.
    const dataModelerItem: ChoiceItem = {
        label: '',
        description: l10n.t('Try Data Modeler'),
        detail: l10n.t('Model your workload and get partition key recommendations.'),
        iconPath: new vscode.ThemeIcon('sparkle'),
        alwaysShow: true,
        action: 'dataModeler',
    };
    const separator: ChoiceItem = { label: '', kind: vscode.QuickPickItemKind.Separator };

    const update = (error?: string): void => {
        const name = quickPick.value.trim();
        const createItem: ChoiceItem = {
            label: '',
            description: name ? l10n.t('Create database "{name}"', { name }) : l10n.t('Create database'),
            detail: error ?? (name ? undefined : l10n.t('Type a name to create a database manually.')),
            iconPath: new vscode.ThemeIcon(error ? 'error' : 'add'),
            alwaysShow: true,
            action: 'create',
        };
        quickPick.items = [createItem, separator, dataModelerItem];
        quickPick.activeItems = [createItem];
    };

    quickPick.title = l10n.t('Create database');
    quickPick.placeholder = l10n.t('Enter a database name');
    quickPick.ignoreFocusOut = true;
    update();

    try {
        return await new Promise<DatabaseCreationChoice>((resolve, reject) => {
            disposables.push(
                quickPick.onDidChangeValue((value) => {
                    const name = value.trim();
                    update(name ? validateDatabaseName(name) : undefined);
                }),
                quickPick.onDidAccept(async () => {
                    if (quickPick.activeItems[0]?.action === 'dataModeler') {
                        resolve({ kind: 'dataModeler' });
                        return;
                    }

                    const name = quickPick.value.trim();
                    let error = validateDatabaseName(name);
                    if (!error) {
                        quickPick.busy = true;
                        quickPick.enabled = false;
                        try {
                            error = await validateDatabaseNameAvailable(accountInfo, name);
                        } finally {
                            quickPick.busy = false;
                            quickPick.enabled = true;
                        }
                    }

                    if (error) {
                        update(error);
                    } else {
                        resolve({ kind: 'manual', databaseName: name });
                    }
                }),
                quickPick.onDidHide(() => reject(new UserCancelledError())),
            );
            quickPick.show();
        });
    } finally {
        // Dispose listeners before the quick pick so its hide event is not handled after a choice is made.
        for (const disposable of disposables.reverse()) {
            disposable.dispose();
        }
    }
}
