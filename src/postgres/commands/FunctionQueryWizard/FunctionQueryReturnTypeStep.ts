/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem, IWizardOptions } from "vscode-azureextensionui";
import { ext } from "../../../extensionVariables";
import { localize } from "../../../utils/localize";
import { FunctionQueryCustomReturnTypeStep } from "./FunctionQueryCustomReturnTypeStep";
import { IPostgresFunctionQueryWizardContext } from "./IPostgresFunctionQueryWizardContext";

export class FunctionQueryReturnTypeStep extends AzureWizardPromptStep<IPostgresFunctionQueryWizardContext> {
    public async prompt(wizardContext: IPostgresFunctionQueryWizardContext): Promise<void> {
        const returnTypeQuickPicks: IAzureQuickPickItem<string | undefined>[] = returnTypes.map(r => { return { label: r, data: r }; });
        returnTypeQuickPicks.push({ label: localize('enterCustomReturnType', '$(pencil) Enter custom return type...'), data: undefined });

        wizardContext.returnType = (await ext.ui.showQuickPick(returnTypeQuickPicks, {
            placeHolder: localize('selectReturnType', 'Select return type')
        })).data;
    }

    public shouldPrompt(wizardContext: IPostgresFunctionQueryWizardContext): boolean {
        return !wizardContext.returnType;
    }

    public async getSubWizard(wizardContext: IPostgresFunctionQueryWizardContext): Promise<IWizardOptions<IPostgresFunctionQueryWizardContext> | undefined> {
        return wizardContext.returnType ? undefined : { promptSteps: [new FunctionQueryCustomReturnTypeStep()] };
    }
}

// A subset of return types available on pgAdmin
const returnTypes: string[] = [
    'bigint',
    'bigint[]',
    'boolean',
    'boolean[]',
    'character',
    'character[]',
    'date',
    'date[]',
    'integer',
    'integer[]',
    'json',
    'json[]',
    'oid',
    'oid[]',
    'smallint',
    'smallint[]',
    'void'
];
