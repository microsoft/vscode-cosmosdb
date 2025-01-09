/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { MongoAccountResourceItem } from '../../tree/mongo/MongoAccountResourceItem';
import { localize } from '../../utils/localize';
import { MongoClusterItemBase } from '../tree/MongoClusterItemBase';

export async function copyConnectionString(
    context: IActionContext,
    clusterNode?: MongoClusterItemBase | MongoAccountResourceItem,
): Promise<void> {
    // node ??= ... pick a node if not provided
    if (!clusterNode) {
        throw new Error('No cluster selected.');
    }

    const connectionString = await ext.state.runWithTemporaryDescription(clusterNode.id, 'Working...', async () => {
        if (clusterNode instanceof MongoAccountResourceItem) {
            context.telemetry.properties.experience = clusterNode.experience.api;
            return clusterNode.discoverConnectionString();
        }

        if (clusterNode instanceof MongoClusterItemBase) {
            context.telemetry.properties.experience = clusterNode.mongoCluster.dbExperience?.api;
            return clusterNode.discoverConnectionString();
        }

        return undefined;
    });

    if (!connectionString) {
        void vscode.window.showErrorMessage(
            localize(
                'copyConnectionString.noConnectionString',
                'Failed to extract the connection string from the selected cluster.',
            ),
        );
    } else {
        await vscode.env.clipboard.writeText(connectionString);
        void vscode.window.showInformationMessage(
            localize('copyConnectionString.success', 'The connection string has been copied to the clipboard'),
        );
    }
}
