/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClusterSession } from '../../documentdb/ClusterSession';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { CollectionViewController } from '../../webviews/documentdb/collectionView/collectionViewController';

export async function openCollectionView(context: IActionContext, node?: CollectionItem) {
    if (!node) {
        throw new Error(l10n.t('Invalid collection node'));
    }

    context.telemetry.properties.experience = node?.experience.api;

    return openCollectionViewInternal(context, {
        clusterId: node.cluster.id,
        databaseName: node.databaseInfo.name,
        collectionName: node.collectionInfo.name,
    });
}

export async function openCollectionViewInternal(
    _context: IActionContext,
    props: {
        clusterId: string;
        databaseName: string;
        collectionName: string;
    },
): Promise<void> {
    /**
     * We're starting a new "session" using the existing connection.
     * A session can cache data, handle paging, and convert data.
     */
    const sessionId = await ClusterSession.initNewSession(props.clusterId);

    const view = new CollectionViewController({
        sessionId: sessionId,
        clusterId: props.clusterId,
        databaseName: props.databaseName,
        collectionName: props.collectionName,
    });

    view.revealToForeground();
}
