/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, IAzureQuickPickItem, IWizardOptions } from "@microsoft/vscode-azext-utils";
import { localize } from "../../../../../utils/localize";
import { IPostgresFunctionQueryWizardContext } from "../IPostgresFunctionQueryWizardContext";
import { FunctionQueryCustomReturnTypeStep } from "./FunctionQueryCustomReturnTypeStep";

export class FunctionQueryReturnTypeStep extends AzureWizardPromptStep<IPostgresFunctionQueryWizardContext> {
    public async prompt(context: IPostgresFunctionQueryWizardContext): Promise<void> {
        const returnTypeQuickPicks: IAzureQuickPickItem<string | undefined>[] = returnTypes.map(r => { return { label: r, data: r }; });
        returnTypeQuickPicks.push({ label: localize('enterCustomReturnType', '$(pencil) Enter custom return type...'), data: undefined });

        context.returnType = (await context.ui.showQuickPick(returnTypeQuickPicks, {
            placeHolder: localize('selectReturnType', 'Select return type')
        })).data;
    }

    public shouldPrompt(context: IPostgresFunctionQueryWizardContext): boolean {
        return !context.returnType;
    }

    public async getSubWizard(context: IPostgresFunctionQueryWizardContext): Promise<IWizardOptions<IPostgresFunctionQueryWizardContext> | undefined> {
        return context.returnType ? undefined : { promptSteps: [new FunctionQueryCustomReturnTypeStep()] };
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
    'text',
    'void'
];
