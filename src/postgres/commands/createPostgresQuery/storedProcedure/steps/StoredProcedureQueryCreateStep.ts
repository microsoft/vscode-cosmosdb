/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { nonNullProp } from '../../../../../utils/nonNull';
import { wrapArgInQuotes } from '../../../../runPostgresQuery';
import { type IPostgresQueryWizardContext } from '../../IPostgresQueryWizardContext';

export class StoredProcedureQueryCreateStep extends AzureWizardExecuteStep<IPostgresQueryWizardContext> {
    public priority: number = 100;

    public async execute(context: IPostgresQueryWizardContext): Promise<void> {
        context.query = defaultStoredProcedureQuery(nonNullProp(context, 'name'));
    }

    public shouldExecute(): boolean {
        return true;
    }
}

const defaultStoredProcedureQuery = (
    name: string,
) => `CREATE OR REPLACE PROCEDURE ${wrapArgInQuotes(name)}(/* arguments */)
 LANGUAGE plpgsql
AS $$
    BEGIN
    /* stored procedure body */
    END;
$$
`;
