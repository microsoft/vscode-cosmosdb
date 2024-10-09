/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONObject } from '@azure/cosmos';
import type * as React from 'react';
import { type Channel } from '../../../panels/Communication/Channel/Channel';
import { BaseContextProvider } from '../../utils/context/BaseContextProvider';
import { type DispatchAction } from './DocumentState';

export class DocumentContextProvider extends BaseContextProvider {
    constructor(
        channel: Channel,
        private readonly dispatch: (action: DispatchAction) => void,
        dispatchToast: (content: React.ReactNode, options?: unknown) => void,
    ) {
        super(channel, dispatchToast);
    }

    protected initEventListeners(): void {
        super.initEventListeners();

        this.channel.on('setDocument', (documentContent?: JSONObject) => {
            if (documentContent === undefined) {
                this.showToast('Error', 'Document content is undefined', 'error');
                return;
            }

            this.dispatch({ type: 'setDocument', documentContent: JSON.stringify(documentContent, null, 4) });
        });

        this.channel.on('documentError', (error: string) => {
            this.showToast('Error', error, 'error');
        });
    }
}
