/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import { localize } from '../../../../../utils/localize';
import { type IPostgresQueryWizardContext } from '../../IPostgresQueryWizardContext';
import { validateIdentifier } from '../../validateIdentifier';

export class StoredProcedureQueryNameStep extends AzureWizardPromptStep<IPostgresQueryWizardContext> {
    public async prompt(context: IPostgresQueryWizardContext): Promise<void> {
        context.name = (
            await context.ui.showInputBox({
                prompt: localize('provideStoredProcedureName', 'Provide stored procedure name'),
                validateInput: validateIdentifier,
            })
        ).trim();
    }

    public shouldPrompt(context: IPostgresQueryWizardContext): boolean {
        return !context.name;
    }
}
