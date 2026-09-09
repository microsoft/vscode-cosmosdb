/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { DataModelingWizardDrawerTab } from '../../panels/DataModelingWizardDrawerTab';
import { resolveDataModelerAccount, type DataModelerAccountSource } from './resolveDataModelerAccount';

/**
 * Launches the Data-Modeling wizard in an editor webview panel that renders the
 * wizard inside a right-side Fluent UI Drawer.
 */
export async function openDataModelingWizardDrawer(
    context: IActionContext,
    source?: DataModelerAccountSource,
): Promise<void> {
    const account = await resolveDataModelerAccount(context, source);
    if (account) {
        DataModelingWizardDrawerTab.render(account);
    }
}
