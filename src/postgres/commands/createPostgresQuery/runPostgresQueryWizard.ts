/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type AzureWizard } from '@microsoft/vscode-azext-utils';
import { postgresBaseFileName, postgresFileExtension } from '../../../constants';
import { nonNullProp } from '../../../utils/nonNull';
import * as vscodeUtil from '../../../utils/vscodeUtils';
import  { type PostgresFunctionsTreeItem } from '../../tree/PostgresFunctionsTreeItem';
import  { type PostgresStoredProceduresTreeItem } from '../../tree/PostgresStoredProceduresTreeItem';
import { connectPostgresDatabase } from '../connectPostgresDatabase';
import  { type IPostgresQueryWizardContext } from './IPostgresQueryWizardContext';

export async function runPostgresQueryWizard(
    wizard: AzureWizard<IPostgresQueryWizardContext>,
    context: IPostgresQueryWizardContext,
    treeItem?: PostgresFunctionsTreeItem | PostgresStoredProceduresTreeItem,
): Promise<void> {
    await wizard.prompt();
    await wizard.execute();
    await vscodeUtil.showNewFile(nonNullProp(context, 'query'), postgresBaseFileName, postgresFileExtension);

    if (treeItem) {
        await connectPostgresDatabase(context, treeItem.parent);
    }
}
