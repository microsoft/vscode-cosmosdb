/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QuickPickItem } from "vscode";
import { IActionContext } from "vscode-azureextensionui";

export interface IPostgresQueryWizardContext extends IActionContext {
    queryTypePick: QuickPickItem;
    query: string;
}
