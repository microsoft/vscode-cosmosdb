/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, IActionContext } from "vscode-azureextensionui";
import { PostgresStoredProceduresTreeItem } from "../../../tree/PostgresStoredProceduresTreeItem";
import { runPostgresQueryWizard } from "../runPostgresQueryWizard";
import { StoredProcedureQueryCreateStep } from "./steps/StoredProcedureQueryCreateStep";
import { StoredProcedureQueryNameStep } from "./steps/StoredProcedureQueryNameStep";

export async function createPostgresStoredProcedureQuery(context: IActionContext, treeItem?: PostgresStoredProceduresTreeItem): Promise<void> {
    const wizard = new AzureWizard(context, {
        promptSteps: [new StoredProcedureQueryNameStep()],
        executeSteps: [new StoredProcedureQueryCreateStep()],
        title: 'Create PostgreSQL Stored Procedure Query'
    });

    await runPostgresQueryWizard(wizard, context, treeItem);
}
