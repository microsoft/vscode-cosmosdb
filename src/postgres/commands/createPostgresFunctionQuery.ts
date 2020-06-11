/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, IActionContext } from "vscode-azureextensionui";
import { PostgresFunctionsTreeItem } from "../tree/PostgresFunctionsTreeItem";
import { FunctionQueryCreateStep } from "./PostgresQueryWizards/FunctionQueryWizard/FunctionQueryCreateStep";
import { FunctionQueryNameStep } from "./PostgresQueryWizards/FunctionQueryWizard/FunctionQueryNameStep";
import { FunctionQueryReturnTypeStep } from "./PostgresQueryWizards/FunctionQueryWizard/FunctionQueryReturnTypeStep";
import { IPostgresFunctionQueryWizardContext } from "./PostgresQueryWizards/FunctionQueryWizard/IPostgresFunctionQueryWizardContext";
import { runPostgresQueryWizard } from "./PostgresQueryWizards/runPostgresQueryWizard";

export async function createPostgresFunctionQuery(context: IActionContext, treeItem?: PostgresFunctionsTreeItem): Promise<void> {
    const wizardContext: IPostgresFunctionQueryWizardContext = context;
    const wizard = new AzureWizard(wizardContext, {
        promptSteps: [new FunctionQueryNameStep(), new FunctionQueryReturnTypeStep()],
        executeSteps: [new FunctionQueryCreateStep()],
        title: 'Create PostgreSQL Function Query'
    });

    await runPostgresQueryWizard(wizard, wizardContext, treeItem);
}
