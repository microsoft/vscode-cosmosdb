/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from "vscode-azureextensionui";
import { nonNullProp } from "../../../utils/nonNull";
import { IPostgresFunctionQueryWizardContext } from "./IPostgresFunctionQueryWizardContext";

export class FunctionQueryCreateStep extends AzureWizardExecuteStep<IPostgresFunctionQueryWizardContext> {
    public priority: number = 100;

    public async execute(wizardContext: IPostgresFunctionQueryWizardContext): Promise<void> {
        wizardContext.query = defaultFunctionQuery(nonNullProp(wizardContext, 'name'), nonNullProp(wizardContext, 'returnType'));
    }

    public shouldExecute(): boolean {
        return true;
    }
}

const defaultFunctionQuery = (name: string, returnType: string) => `CREATE OR REPLACE FUNCTION ${name}(/* arguments */)
 RETURNS ${returnType}
 LANGUAGE plpgsql
AS $function$
    BEGIN
    /* function body */
    END;
$function$
`;
