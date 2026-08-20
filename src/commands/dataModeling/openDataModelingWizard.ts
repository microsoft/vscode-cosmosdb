/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { DataModelingWizardTab } from '../../panels/DataModelingWizardTab';

/** Launches the Data-Modeling wizard in an editor webview panel. */
export async function openDataModelingWizard(_context: IActionContext): Promise<void> {
    DataModelingWizardTab.render();
}
