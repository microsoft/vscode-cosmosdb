/* eslint-disable @typescript-eslint/no-unused-vars */
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from "@microsoft/vscode-azext-utils";
import { QuickPickItemKind, ThemeIcon } from "vscode";
import { localize } from "../../../utils/localize";
import { IAuthenticateWizardContext } from "./IAuthenticateWizardContext";

export class SelectUserNameStep extends AzureWizardPromptStep<IAuthenticateWizardContext> {
    public async prompt(context: IAuthenticateWizardContext): Promise<void> {
        const res = (await context.ui.showQuickPick(
            [
                { label: context.adminUserName,
                    description: 'Administrator',
                    iconPath: new ThemeIcon('account') // https://code.visualstudio.com/api/references/icons-in-labels#icon-listing
                },
                { label: 'All Users', kind: QuickPickItemKind.Separator },
                ...context.otherUserNames.map( // '...' is the spread operator
                    userName => ({ label: userName, iconPath: new ThemeIcon('person') })
                )
            ],
            {
                placeHolder: localize('vCoreAuthWizardUserName', 'Please select a user name to authenticate with'),
                suppressPersistence: true
            }
        ));

        context.selectedUserName = res.label;
    }

    public async configureBeforePrompt(wizardContext: IAuthenticateWizardContext): Promise<void> {
        // in case there is actually only the admin user name specified,
        // we can skip the prompt and just select the admin user name.
        if (wizardContext.otherUserNames.length === 0) {
            wizardContext.selectedUserName = wizardContext.adminUserName;
        }
    }

    public shouldPrompt(context: IAuthenticateWizardContext): boolean {
        return !context.selectedUserName;
    }
}
