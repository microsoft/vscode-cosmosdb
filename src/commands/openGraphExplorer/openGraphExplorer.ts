/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { openUrl } from '../../utils/openUrl';

const alternativeGraphVisualizationToolsDocLink = 'https://aka.ms/cosmosdb-graph-alternative-tools';

export async function openGraphExplorer() {
    const message: string = vscode.l10n.t('Cosmos DB Graph extension has been retired.');
    const alternativeToolsOption = 'Alternative Tools';
    const result = await vscode.window.showErrorMessage(message, alternativeToolsOption);
    if (result === alternativeToolsOption) {
        await openUrl(alternativeGraphVisualizationToolsDocLink);
    }
}
