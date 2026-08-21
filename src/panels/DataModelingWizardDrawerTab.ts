/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { BaseTab } from './BaseTab';

/**
 * Editor webview panel host for the Data-Modeling wizard rendered inside a
 * right-side Fluent UI Drawer (see the `cosmosDbDataModelingDrawer` view in the
 * webview registry). Behaves like {@link DataModelingWizardTab} but mounts the
 * drawer chrome instead of the full-page wizard.
 */
export class DataModelingWizardDrawerTab extends BaseTab {
    public static readonly viewType = 'cosmosDbDataModelingDrawer';
    public static readonly openTabs: Set<DataModelingWizardDrawerTab> = new Set<DataModelingWizardDrawerTab>();

    protected constructor(panel: vscode.WebviewPanel) {
        super(panel, DataModelingWizardDrawerTab.viewType);
        DataModelingWizardDrawerTab.openTabs.add(this);
    }

    public static render(viewColumn?: vscode.ViewColumn): DataModelingWizardDrawerTab {
        const column = viewColumn ?? vscode.ViewColumn.Active;

        // Reuse an already-open drawer tab rather than stacking duplicates.
        const existing = [...DataModelingWizardDrawerTab.openTabs][0];
        if (existing) {
            existing.panel.reveal(column);
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            DataModelingWizardDrawerTab.viewType,
            l10n.t('Data Modeler'),
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        return new DataModelingWizardDrawerTab(panel);
    }

    public dispose(): void {
        DataModelingWizardDrawerTab.openTabs.delete(this);
        super.dispose();
    }
}
