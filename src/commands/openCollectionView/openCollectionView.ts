/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { MongoClustersSession } from '../../documentdb/MongoClusterSession';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { CollectionViewController } from '../../webviews/mongoClusters/collectionView/collectionViewController';

export async function openCollectionView(context: IActionContext, node?: CollectionItem) {
    if (!node) {
        throw new Error(l10n.t('Invalid collection node'));
    }

    context.telemetry.properties.experience = node?.mongoCluster.dbExperience?.api;

    return openCollectionViewInternal(context, {
        id: node.id,
        clusterId: node.mongoCluster.id,
        databaseName: node.databaseInfo.name,
        collectionName: node.collectionInfo.name,
        collectionTreeItem: node,
    });
}

export async function openCollectionViewInternal(
    _context: IActionContext,
    props: {
        id: string;
        clusterId: string;
        databaseName: string;
        collectionName: string;
        collectionTreeItem: CollectionItem;
    },
): Promise<void> {
    /**
     * We're starting a new "session" using the existing connection.
     * A session can cache data, handle paging, and convert data.
     */
    const sessionId = await MongoClustersSession.initNewSession(props.clusterId);

    const view = new CollectionViewController({
        id: props.id,

        sessionId: sessionId,
        clusterId: props.clusterId,
        databaseName: props.databaseName,
        collectionName: props.collectionName,
        collectionTreeItem: props.collectionTreeItem,
    });

    view.revealToForeground();
}
