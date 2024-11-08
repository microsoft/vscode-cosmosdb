/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface AuthenticateWizardContext extends IActionContext {
    /** These values have to be provided for the wizard to function correctly. */
    adminUserName: string;
    otherUserNames: string[];
    resourceName: string;

    /** These values will be populated by the wizard. */
    selectedUserName?: string;
    password?: string;
    aborted?: boolean;
}
