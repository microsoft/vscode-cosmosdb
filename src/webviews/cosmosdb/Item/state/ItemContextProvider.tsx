/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONObject, type JSONValue, type PartitionKey, type PartitionKeyDefinition } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import type * as React from 'react';
import { type CosmosDBRecord } from '../../../../cosmosdb/types/queryResult';
import { type Channel } from '../../../../panels/Communication/Channel/Channel';
import { BaseContextProvider } from '../../../utils/context/BaseContextProvider';
import { type DispatchAction, type OpenItemMode } from './ItemState';

export class ItemContextProvider extends BaseContextProvider {
    constructor(
        channel: Channel,
        private readonly dispatch: (action: DispatchAction) => void,
        dispatchToast: (content: React.ReactNode, options?: unknown) => void,
    ) {
        super(channel, dispatchToast);
    }

    public async saveItem(itemText: string): Promise<void> {
        this.dispatch({ type: 'setSaving', isSaving: true });

        await this.sendCommand('saveItem', itemText);
    }
    public async refreshItem(): Promise<void> {
        this.dispatch({ type: 'setError', error: undefined });
        this.dispatch({ type: 'setRefreshing', isRefreshing: true });

        await this.sendCommand('refreshItem');
    }

    public setCurrentItemContent(content: string): void {
        this.dispatch({ type: 'setValid', isValid: this.validateJson(content) });
        this.dispatch({ type: 'setCurrentItem', itemContent: content });
    }
    public setValid(isValid: boolean, errors?: string[]): void {
        this.dispatch({ type: 'setValid', isValid });
        if (errors) {
            this.dispatch({ type: 'setError', error: errors.join('\n') });
        }
    }

    public setMode(mode: OpenItemMode): Promise<void> {
        return this.sendCommand('setMode', mode);
    }
    public async notifyDirty(isDirty: boolean): Promise<void> {
        await this.sendCommand('setDirty', isDirty);
    }

    protected initEventListeners(): void {
        super.initEventListeners();

        this.channel.on(
            'initState',
            (
                mode: OpenItemMode,
                databaseId: string,
                containerId: string,
                itemId: string,
                partitionKey?: PartitionKey,
            ) => {
                if (partitionKey === null) {
                    partitionKey = undefined;
                }

                this.dispatch({ type: 'initState', mode, databaseId, containerId, itemId, partitionKey });
                this.dispatch({ type: 'setRefreshing', isRefreshing: true });
            },
        );

        this.channel.on('modeChanged', (mode: OpenItemMode) => {
            this.dispatch({ type: 'setMode', mode });
        });

        this.channel.on(
            'setItem',
            (_sessionId: string, itemContent: CosmosDBRecord, partitionKey: PartitionKeyDefinition) => {
                this.dispatch({ type: 'setRefreshing', isRefreshing: false });
                this.dispatch({ type: 'setSaving', isSaving: false });

                if (itemContent === undefined) {
                    this.dispatch({ type: 'setError', error: l10n.t('Item content is undefined') });
                    return;
                }

                this.dispatch({
                    type: 'setItem',
                    itemContent: JSON.stringify(itemContent, null, 4),
                    partitionKey,
                });
            },
        );

        this.channel.on('itemSaved', () => {
            this.dispatch({ type: 'setSaving', isSaving: false });
        });

        this.channel.on('itemError', (_sessionId: string, error: string) => {
            this.dispatch({ type: 'setRefreshing', isRefreshing: false });
            this.dispatch({ type: 'setSaving', isSaving: false });
            this.dispatch({ type: 'setError', error: this.parseError(error) });
        });

        this.channel.on('queryError', (_sessionId: string, _error: string) => {
            this.dispatch({ type: 'setRefreshing', isRefreshing: false });
            this.dispatch({ type: 'setSaving', isSaving: false });
        });
    }

    private parseError(error: string): string {
        try {
            const parsedError: JSONValue = JSON.parse(error) as JSONValue;

            if (parsedError && typeof parsedError === 'object' && !Array.isArray(parsedError)) {
                const error = parsedError as JSONObject;
                return error?.message?.toString() || JSON.stringify(error, null, 4);
            }

            return `${error}`;
        } catch {
            return error;
        }
    }

    private validateJson(json: string): boolean {
        try {
            JSON.parse(json);
            return true;
        } catch {
            return false;
        }
    }
}
