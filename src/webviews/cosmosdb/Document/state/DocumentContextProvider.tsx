/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONObject, type JSONValue, type PartitionKey, type PartitionKeyDefinition } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import { type DocumentEvent } from '../../../api/configuration/routers/documentEventsRouter';
import { BaseContextProvider, type DispatchToastFn, type TrpcClient } from '../../../utils/context/BaseContextProvider';
import { type DispatchAction, type OpenDocumentMode } from './DocumentState';

export class DocumentContextProvider extends BaseContextProvider {
    private eventSubscription?: { unsubscribe: () => void };
    declare protected readonly trpcClient: TrpcClient;

    constructor(
        private readonly dispatch: (action: DispatchAction) => void,
        dispatchToast: DispatchToastFn,
        trpcClient: TrpcClient,
    ) {
        super(dispatchToast, trpcClient);
    }

    public async saveDocument(documentText: string): Promise<void> {
        this.dispatch({ type: 'setSaving', isSaving: true });
        await this.trpcClient.document.saveDocument.mutate({ documentText });
    }
    public async saveDocumentAsFile(documentText: string): Promise<void> {
        await this.trpcClient.document.saveDocumentAsFile.mutate({ documentText });
    }
    public async refreshDocument(): Promise<void> {
        this.dispatch({ type: 'setError', error: undefined });
        this.dispatch({ type: 'setRefreshing', isRefreshing: true });
        await this.trpcClient.document.refreshDocument.mutate();
    }

    public setCurrentDocumentContent(content: string): void {
        this.dispatch({ type: 'setValid', isValid: this.validateJson(content) });
        this.dispatch({ type: 'setCurrentDocument', documentContent: content });
    }
    public setValid(isValid: boolean, errors?: string[]): void {
        this.dispatch({ type: 'setValid', isValid });
        if (errors) {
            this.dispatch({ type: 'setError', error: errors });
        }
    }

    public async setMode(mode: OpenDocumentMode): Promise<void> {
        await this.trpcClient.document.setMode.mutate({ mode });
    }
    public async notifyDirty(isDirty: boolean): Promise<void> {
        await this.trpcClient.document.setDirty.mutate({ isDirty });
    }

    public dispose() {
        this.eventSubscription?.unsubscribe();
        super.dispose();
    }

    protected init(): void {
        // Call tRPC getInitialState instead of sending legacy 'ready' channel event
        void this.trpcClient.document.getInitialState.query();
    }

    protected initEventListeners(): void {
        this.eventSubscription = this.trpcClient.document.events.subscribe(undefined, {
            onData: (event: DocumentEvent) => {
                this.handleDocumentEvent(event);
            },
        });
    }

    private handleDocumentEvent(event: DocumentEvent): void {
        switch (event.type) {
            case 'initState':
                this.dispatch({
                    type: 'initState',
                    mode: event.mode,
                    databaseId: event.databaseId,
                    containerId: event.containerId,
                    documentId: event.documentId,
                    partitionKey: event.partitionKey as PartitionKey | undefined,
                });
                this.dispatch({ type: 'setRefreshing', isRefreshing: true });
                break;
            case 'modeChanged':
                this.dispatch({ type: 'setMode', mode: event.mode });
                break;
            case 'setDocument':
                this.dispatch({ type: 'setRefreshing', isRefreshing: false });
                this.dispatch({ type: 'setSaving', isSaving: false });
                if (event.documentContent === undefined) {
                    this.dispatch({ type: 'setError', error: l10n.t('Item content is undefined') });
                    return;
                }
                this.dispatch({
                    type: 'setDocument',
                    documentContent: JSON.stringify(event.documentContent, null, 4),
                    partitionKey: (event.partitionKey ?? undefined) as PartitionKeyDefinition,
                });
                break;
            case 'documentSaved':
                this.dispatch({ type: 'setSaving', isSaving: false });
                break;
            case 'documentError':
                this.dispatch({ type: 'setRefreshing', isRefreshing: false });
                this.dispatch({ type: 'setSaving', isSaving: false });
                this.dispatch({ type: 'setError', error: this.parseError(event.error) });
                break;
            case 'queryError':
                this.dispatch({ type: 'setRefreshing', isRefreshing: false });
                this.dispatch({ type: 'setSaving', isSaving: false });
                break;
            case 'operationAborted':
                this.dispatch({ type: 'setRefreshing', isRefreshing: false });
                this.dispatch({ type: 'setSaving', isSaving: false });
                if (event.message) {
                    void this.showInformationMessage(event.message);
                }
                break;
        }
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
