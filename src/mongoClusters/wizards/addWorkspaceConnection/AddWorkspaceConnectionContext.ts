/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface AddWorkspaceConnectionContext extends IActionContext {
    /** These values will be populated by the wizard. */
    connectionString?: string;
    username?: string;
    password?: string;

    aborted?: boolean;
}
