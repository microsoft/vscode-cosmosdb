/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { DataModelingWizardDrawerTab } from '../../panels/DataModelingWizardDrawerTab';

/**
 * Launches the Data-Modeling wizard in an editor webview panel that renders the
 * wizard inside a right-side Fluent UI Drawer.
 */
export async function openDataModelingWizardDrawer(_context: IActionContext): Promise<void> {
    DataModelingWizardDrawerTab.render();
}
