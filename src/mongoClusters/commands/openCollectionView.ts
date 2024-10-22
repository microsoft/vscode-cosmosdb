/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { CollectionViewController } from '../../webviews/mongoClusters/collectionView/collectionViewController';
import { MongoClustersSession } from '../MongoClusterSession';

export async function openCollectionView(
    _context: IActionContext,
    props: {
        id: string;
        liveConnectionId: string;
        databaseName: string;
        collectionName: string;
    },
): Promise<void> {
    /**
     * We're starting a new "session" using the existing connection.
     * A session can cache data, handle paging, and convert data.
     */
    const sessionId = await MongoClustersSession.initNewSession(props.liveConnectionId);

    const view = new CollectionViewController({
        id: props.id,

        sessionId: sessionId,
        databaseName: props.databaseName,
        collectionName: props.collectionName,
    });

    view.revealToForeground();
}
