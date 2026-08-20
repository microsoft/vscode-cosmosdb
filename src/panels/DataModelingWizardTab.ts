/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { BaseTab } from './BaseTab';

/**
 * Editor webview panel host for the Data-Modeling (Partition Key Advisor)
 * wizard. The wizard is a self-contained React/Fluent UI prototype with no
 * backend, so this host only needs to create the panel and load the view.
 */
export class DataModelingWizardTab extends BaseTab {
    public static readonly viewType = 'cosmosDbDataModeling';
    public static readonly openTabs: Set<DataModelingWizardTab> = new Set<DataModelingWizardTab>();

    protected constructor(panel: vscode.WebviewPanel) {
        super(panel, DataModelingWizardTab.viewType);
        DataModelingWizardTab.openTabs.add(this);
    }

    public static render(viewColumn?: vscode.ViewColumn): DataModelingWizardTab {
        const column = viewColumn ?? vscode.ViewColumn.Active;

        // Reuse an already-open wizard tab rather than stacking duplicates.
        const existing = [...DataModelingWizardTab.openTabs][0];
        if (existing) {
            existing.panel.reveal(column);
            return existing;
        }

        const panel = vscode.window.createWebviewPanel(
            DataModelingWizardTab.viewType,
            l10n.t('Data Modeling'),
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        return new DataModelingWizardTab(panel);
    }

    public dispose(): void {
        DataModelingWizardTab.openTabs.delete(this);
        super.dispose();
    }
}
