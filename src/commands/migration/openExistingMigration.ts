/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { MigrationAssistantTab } from '../../panels/MigrationAssistantTab';
import { type MigrationItem } from '../../tree/workspace-view/migration/MigrationItem';

export async function openExistingMigration(_context: IActionContext, node?: MigrationItem): Promise<void> {
    if (!node) {
        return;
    }

    MigrationAssistantTab.render(node.model.migrationPath);
}
