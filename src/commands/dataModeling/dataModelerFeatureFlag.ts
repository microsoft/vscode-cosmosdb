/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const DATA_MODELER_ENABLED_SETTING = 'cosmosDB.experimental.dataModeler.enabled';

export function isDataModelerFeatureEnabled(): boolean {
    return vscode.workspace.getConfiguration('cosmosDB').get<boolean>('experimental.dataModeler.enabled', true) ?? true;
}
