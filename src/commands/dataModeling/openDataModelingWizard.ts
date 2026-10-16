/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { DataModelingWizardTab } from '../../panels/DataModelingWizardTab';
import { ensureAIFeaturesEnabled } from '../../utils/copilotUtils';
import { resolveDataModelerAccount, type DataModelerAccountSource } from './resolveDataModelerAccount';

/** Launches the Data-Modeling wizard in an editor webview panel. */
export async function openDataModelingWizard(
    context: IActionContext,
    source?: DataModelerAccountSource,
): Promise<void> {
    await ensureAIFeaturesEnabled();
    const account = await resolveDataModelerAccount(context, source);
    if (account) {
        await ensureAIFeaturesEnabled();
        DataModelingWizardTab.render(account);
    }
}
