/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, AzureWizardPromptStep } from "vscode-azureextensionui";
import * as vscodeUtil from '../../utils/vscodeUtils';
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";
import { connectPostgresDatabase } from "./connectPostgresDatabase";
import { IPostgresQueryWizardContext } from "./PostgresQueryWizard/IPostgresQueryWizardContext";
import { QueryTypeStep } from "./PostgresQueryWizard/QueryTypeStep";

export async function createPostgresQuery(wizardContext: IPostgresQueryWizardContext, treeItem?: PostgresDatabaseTreeItem): Promise<void> {
    const promptSteps: AzureWizardPromptStep<IPostgresQueryWizardContext>[] = [
        new QueryTypeStep(),
    ];

    const wizard = new AzureWizard(wizardContext, {
        promptSteps,
        title: 'Create PostgreSQL query from template'
    });

    await wizard.prompt();
    await wizard.execute();
    await vscodeUtil.showNewFile(wizardContext.query, 'query', '.sql');

    if (treeItem) {
        await connectPostgresDatabase(wizardContext, treeItem);
    }
}
