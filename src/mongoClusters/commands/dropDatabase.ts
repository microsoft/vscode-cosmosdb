/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { localize } from '../../utils/localize';
import { type DatabaseItem } from '../tree/DatabaseItem';

export async function dropDatabase(context: IActionContext, node?: DatabaseItem): Promise<void> {
    context.telemetry.properties.experience = node?.mongoCluster.dbExperience?.api;

    // node ??= ... pick a node if not provided
    if (!node) {
        throw new Error('No database selected.');
    }

    const confirmed = await getConfirmationAsInSettings(
        `Drop "${node?.databaseInfo.name}"?`,
        `Drop database "${node?.databaseInfo.name}" and its contents?\nThis can't be undone.`,
        node?.databaseInfo.name,
    );

    if (!confirmed) {
        return;
    }

    const success = await node.delete(context);

    if (success) {
        showConfirmationAsInSettings(
            localize(
                'showConfirmation.droppedDatabase',
                'The "{0}" database has been dropped.',
                node.databaseInfo.name,
            ),
        );
    }
}
