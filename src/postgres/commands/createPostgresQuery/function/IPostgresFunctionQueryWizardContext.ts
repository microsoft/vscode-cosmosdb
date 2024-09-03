/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IPostgresQueryWizardContext } from '../IPostgresQueryWizardContext';

export interface IPostgresFunctionQueryWizardContext extends IPostgresQueryWizardContext {
    returnType?: string;
}
