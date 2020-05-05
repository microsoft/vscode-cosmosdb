/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QuickPickItem } from "vscode";
import { AzureWizardPromptStep, IWizardOptions } from "vscode-azureextensionui";
import { ext } from "../../../extensionVariables";
import { localize } from "../../../utils/localize";
import { FunctionQueryCreateStep } from "./FunctionQuerySteps/FunctionQueryCreateStep";
import { FunctionQueryNameStep } from "./FunctionQuerySteps/FunctionQueryNameStep";
import { FunctionQueryReturnTypeStep } from "./FunctionQuerySteps/FunctionQueryReturnTypeStep";
import { IPostgresQueryWizardContext } from "./IPostgresQueryWizardContext";

const functionPick: QuickPickItem = { label: localize('function', 'Function') };

export class QueryTypeStep extends AzureWizardPromptStep<IPostgresQueryWizardContext> {
    public async prompt(wizardContext: IPostgresQueryWizardContext): Promise<void> {
        wizardContext.queryTypePick = await ext.ui.showQuickPick([functionPick], { placeHolder: localize('selectQueryTemplate', 'Select query template') });
    }

    public shouldPrompt(): boolean {
        return true;
    }

    public async getSubWizard(wizardContext: IPostgresQueryWizardContext): Promise<IWizardOptions<IPostgresQueryWizardContext> | undefined> {
        const subWizardOptions: IWizardOptions<IPostgresQueryWizardContext> = {};

        switch (wizardContext.queryTypePick) {
            case functionPick:
            default:
                subWizardOptions.promptSteps = [new FunctionQueryNameStep(), new FunctionQueryReturnTypeStep()];
                subWizardOptions.executeSteps = [new FunctionQueryCreateStep()];
        }

        return subWizardOptions;
    }
}
