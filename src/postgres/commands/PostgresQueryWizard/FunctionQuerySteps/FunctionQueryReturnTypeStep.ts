/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QuickPickItem } from "vscode";
import { AzureWizardPromptStep, IWizardOptions } from "vscode-azureextensionui";
import { ext } from "../../../../extensionVariables";
import { localize } from "../../../../utils/localize";
import { FunctionQueryCustomReturnTypeStep } from "./FunctionQueryCustomReturnTypeStep";
import { IPostgresFunctionQueryWizardContext } from "./IPostgresFunctionQueryWizardContext";

const customReturnTypePick: QuickPickItem = { label: localize('enterCustomReturnType', '$(pencil) Enter custom return type...') };

export class FunctionQueryReturnTypeStep extends AzureWizardPromptStep<IPostgresFunctionQueryWizardContext> {
    public async prompt(wizardContext: IPostgresFunctionQueryWizardContext): Promise<void> {
        const returnTypeQuickPicks: QuickPickItem[] = returnTypes.map(r => { return { label: r }; });
        returnTypeQuickPicks.push(customReturnTypePick);

        wizardContext.returnTypePick = (await ext.ui.showQuickPick(returnTypeQuickPicks, {
            placeHolder: localize('selectReturnType', 'Select return type')
        }));
    }

    public shouldPrompt(): boolean {
        return true;
    }

    public async getSubWizard(wizardContext: IPostgresFunctionQueryWizardContext): Promise<IWizardOptions<IPostgresFunctionQueryWizardContext> | undefined> {
        if (wizardContext.returnTypePick === customReturnTypePick) {
            return { promptSteps: [new FunctionQueryCustomReturnTypeStep()] };
        }

        wizardContext.returnType = wizardContext.returnTypePick.label;
        return undefined;
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
