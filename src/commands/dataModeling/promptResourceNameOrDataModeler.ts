/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

type ResourceCreationChoice = { kind: 'manual'; name: string } | { kind: 'dataModeler' };

interface ResourceNamePromptOptions {
    value?: string;
    title: string;
    placeholder: string;
    detail: string;
    createLabel: (name: string) => string;
    validateName: (name: string) => string | undefined;
    validateNameAvailable: (name: string) => Promise<string | undefined>;
}

type ChoiceItem = vscode.QuickPickItem & { action?: 'create' | 'dataModeler' };

/**
 * Prompts for a resource name in an editable quick pick that also offers Data Modeler, so choosing the guided
 * experience does not add a step to manual creation. Quick picks have no validation message area, so name errors are
 * shown on the create item.
 */
export async function promptResourceNameOrDataModeler(
    options: ResourceNamePromptOptions,
): Promise<ResourceCreationChoice> {
    const quickPick = vscode.window.createQuickPick<ChoiceItem>();
    const disposables: vscode.Disposable[] = [quickPick];
    // Data Modeler is shown only while the name is empty, so its label is never matched against typed text.
    const dataModelerItem: ChoiceItem = {
        label: l10n.t('Try Data Modeler'),
        detail: l10n.t('Model your workload and get partition key recommendations.'),
        iconPath: new vscode.ThemeIcon('sparkle'),
        alwaysShow: true,
        action: 'dataModeler',
    };
    const separator: ChoiceItem = { label: '', kind: vscode.QuickPickItemKind.Separator };

    const update = (error?: string): void => {
        const name = quickPick.value.trim();
        // VS Code highlights typed text in labels but not descriptions. The label is used only while the name is empty,
        // when there is nothing to match, so the item keeps the normal label size until typing starts.
        const createItem: ChoiceItem = {
            label: name ? '' : options.title,
            description: name
                ? `${options.createLabel(name)} ${l10n.t("(Press 'Enter' to confirm or 'Escape' to cancel)")}`
                : undefined,
            detail: error ?? (name ? undefined : options.detail),
            iconPath: new vscode.ThemeIcon(error ? 'error' : 'add'),
            alwaysShow: true,
            action: 'create',
        };
        quickPick.items = name ? [createItem] : [createItem, separator, dataModelerItem];
        quickPick.activeItems = [createItem];
    };

    quickPick.title = options.title;
    quickPick.placeholder = options.placeholder;
    quickPick.ignoreFocusOut = true;
    quickPick.value = options.value ?? '';
    update();

    try {
        return await new Promise<ResourceCreationChoice>((resolve, reject) => {
            disposables.push(
                quickPick.onDidChangeValue((value) => {
                    const name = value.trim();
                    update(name ? options.validateName(name) : undefined);
                }),
                quickPick.onDidAccept(async () => {
                    if (quickPick.activeItems[0]?.action === 'dataModeler') {
                        resolve({ kind: 'dataModeler' });
                        return;
                    }

                    const name = quickPick.value.trim();
                    let error = options.validateName(name);
                    if (!error) {
                        quickPick.busy = true;
                        quickPick.enabled = false;
                        try {
                            error = await options.validateNameAvailable(name);
                        } catch (error) {
                            reject(error instanceof Error ? error : new Error(String(error)));
                            return;
                        } finally {
                            quickPick.busy = false;
                            quickPick.enabled = true;
                        }
                    }

                    if (error) {
                        update(error);
                    } else {
                        resolve({ kind: 'manual', name });
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
