/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKey } from '@azure/cosmos';
import type * as React from 'react';
import { type CosmosDbRecord } from '../../../docdb/types/queryResult';
import { type Channel } from '../../../panels/Communication/Channel/Channel';
import { BaseContextProvider } from '../../utils/context/BaseContextProvider';
import { type DispatchAction, type OpenDocumentMode } from './DocumentState';

export class DocumentContextProvider extends BaseContextProvider {
    constructor(
        channel: Channel,
        private readonly dispatch: (action: DispatchAction) => void,
        dispatchToast: (content: React.ReactNode, options?: unknown) => void,
    ) {
        super(channel, dispatchToast);
    }

    public async refreshDocument(): Promise<void> {
        this.dispatch({ type: 'setError', error: undefined });
        this.dispatch({ type: 'setRefreshing', isRefreshing: true });

        await this.sendCommand('refreshDocument');
    }

    protected initEventListeners(): void {
        super.initEventListeners();

        this.channel.on(
            'initState',
            (
                mode: OpenDocumentMode,
                databaseId: string,
                containerId: string,
                documentId: string,
                partitionKey?: PartitionKey,
            ) => {
                if (partitionKey === null) {
                    partitionKey = undefined;
                }

                this.dispatch({ type: 'initState', mode, databaseId, containerId, documentId, partitionKey });
            },
        );

        this.channel.on('setDocument', (_sessionId: string, documentContent?: CosmosDbRecord) => {
            this.dispatch({ type: 'setRefreshing', isRefreshing: false });

            if (documentContent === undefined) {
                this.dispatch({ type: 'setError', error: 'Document content is undefined' });
                return;
            }

            this.dispatch({ type: 'setDocument', documentContent: JSON.stringify(documentContent, null, 4) });
        });

        this.channel.on('documentError', (_sessionId: string, error: string) => {
            this.dispatch({ type: 'setError', error });
        });
    }
}
