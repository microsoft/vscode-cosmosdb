/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { nonNullProp } from '../../../../../utils/nonNull';
import { wrapArgInQuotes } from '../../../../runPostgresQuery';
import  { type IPostgresFunctionQueryWizardContext } from '../IPostgresFunctionQueryWizardContext';

export class FunctionQueryCreateStep extends AzureWizardExecuteStep<IPostgresFunctionQueryWizardContext> {
    public priority: number = 100;

    public async execute(context: IPostgresFunctionQueryWizardContext): Promise<void> {
        context.query = defaultFunctionQuery(nonNullProp(context, 'name'), nonNullProp(context, 'returnType'));
    }

    public shouldExecute(): boolean {
        return true;
    }
}

const defaultFunctionQuery = (
    name: string,
    returnType: string,
) => `CREATE OR REPLACE FUNCTION ${wrapArgInQuotes(name)}(/* arguments */)
 RETURNS ${returnType}
 LANGUAGE plpgsql
AS $function$
    BEGIN
    /* function body */
    END;
$function$
`;
