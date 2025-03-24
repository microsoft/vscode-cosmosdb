/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ScrapbookService } from '../../documentdb/scrapbook/ScrapbookService';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

export async function connectCluster(_context: IActionContext, node?: DatabaseItem | CollectionItem): Promise<void> {
    if (!node) {
        await vscode.window.showInformationMessage(
            l10n.t('You can connect to a different Mongo Cluster by:') +
                '\n\n' +
                l10n.t("1. Locating the one you'd like from the resource view,") +
                '\n' +
                l10n.t('2. Selecting a database or a collection,') +
                '\n' +
                l10n.t('3. Right-clicking and then choosing the "Mongo Scrapbook" submenu,') +
                '\n' +
                l10n.t('4. Selecting the "Connect to this database" command.'),
            { modal: true },
        );
        return;
    }

    await ScrapbookService.setConnectedCluster(node.cluster, node.databaseInfo);
}
