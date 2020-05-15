/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, IActionContext } from "vscode-azureextensionui";
import { nonNullProp } from "../../utils/nonNull";
import * as vscodeUtil from '../../utils/vscodeUtils';
import { PostgresFunctionsTreeItem } from "../tree/PostgresFunctionsTreeItem";
import { connectPostgresDatabase } from "./connectPostgresDatabase";
import { FunctionQueryCreateStep } from "./FunctionQueryWizard/FunctionQueryCreateStep";
import { FunctionQueryNameStep } from "./FunctionQueryWizard/FunctionQueryNameStep";
import { FunctionQueryReturnTypeStep } from "./FunctionQueryWizard/FunctionQueryReturnTypeStep";
import { IPostgresFunctionQueryWizardContext } from "./FunctionQueryWizard/IPostgresFunctionQueryWizardContext";
import { postgresBaseFileName, postgresFileExtension } from "./registerPostgresCommands";

export async function createPostgresFunctionQuery(context: IActionContext, treeItem?: PostgresFunctionsTreeItem): Promise<void> {
    const wizardContext: IPostgresFunctionQueryWizardContext = context;
    const wizard = new AzureWizard(wizardContext, {
        promptSteps: [new FunctionQueryNameStep(), new FunctionQueryReturnTypeStep()],
        executeSteps: [new FunctionQueryCreateStep()],
        title: 'Create PostgreSQL Function Query'
    });

    await wizard.prompt();
    await wizard.execute();
    await vscodeUtil.showNewFile(nonNullProp(wizardContext, 'query'), postgresBaseFileName, postgresFileExtension);

    if (treeItem) {
        await connectPostgresDatabase(wizardContext, treeItem.parent);
    }
}
