/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONObject, type JSONValue, type PartitionKeyDefinition } from '@azure/cosmos';
import { type TRPCClient } from '@trpc/client';
import * as l10n from '@vscode/l10n';
import { type DocumentAppRouter } from '../../../api/types';
import { BaseContextProvider, type DispatchToastFn } from '../../../utils/context/BaseContextProvider';
import { type DispatchAction, type OpenDocumentMode } from './DocumentState';

const emptyPartitionKey: PartitionKeyDefinition = { paths: [] };

export class DocumentContextProvider extends BaseContextProvider<DocumentAppRouter> {
    constructor(
        private readonly dispatch: (action: DispatchAction) => void,
        dispatchToast: DispatchToastFn,
        trpcClient: TRPCClient<DocumentAppRouter>,
    ) {
        super(dispatchToast, trpcClient);
    }

    public async saveDocument(documentText: string): Promise<void> {
        this.dispatch({ type: 'setSaving', isSaving: true });

        try {
            const result = (await this.trpcClient.document.saveDocument.mutate({ documentText })) as {
                success: boolean;
                documentContent?: JSONValue;
                partitionKey?: PartitionKeyDefinition;
            };

            if (result.success && result.documentContent) {
                this.dispatch({
                    type: 'setDocument',
                    documentContent: JSON.stringify(result.documentContent, null, 4),
                    partitionKey: result.partitionKey ?? emptyPartitionKey,
                });
            } else {
                this.dispatch({ type: 'setError', error: l10n.t('Failed to save item') });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.dispatch({ type: 'setError', error: this.parseError(message) });
        } finally {
            this.dispatch({ type: 'setSaving', isSaving: false });
        }
    }

    public async saveDocumentAsFile(documentText: string): Promise<void> {
        await this.trpcClient.document.saveDocumentAsFile.mutate({ documentText });
    }

    public async refreshDocument(): Promise<void> {
        this.dispatch({ type: 'setError', error: undefined });
        this.dispatch({ type: 'setRefreshing', isRefreshing: true });

        try {
            const result = (await this.trpcClient.document.refreshDocument.mutate()) as {
                aborted: boolean;
                documentContent?: JSONValue;
                partitionKey?: PartitionKeyDefinition;
            };

            if (result.aborted) {
                return;
            }

            if (result.documentContent) {
                this.dispatch({
                    type: 'setDocument',
                    documentContent: JSON.stringify(result.documentContent, null, 4),
                    partitionKey: result.partitionKey ?? emptyPartitionKey,
                });
            } else {
                this.dispatch({ type: 'setError', error: l10n.t('Item content is undefined') });
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            this.dispatch({ type: 'setError', error: this.parseError(message) });
        } finally {
            this.dispatch({ type: 'setRefreshing', isRefreshing: false });
        }
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
        const result = await this.trpcClient.document.setMode.mutate({ mode });
        this.dispatch({ type: 'setMode', mode: result.mode });
    }
    public async notifyDirty(isDirty: boolean): Promise<void> {
        await this.trpcClient.document.setDirty.mutate({ isDirty });
    }

    protected init(): void {
        void this.trpcClient.document.getInitialState.query().then((result) => {
            this.dispatch({
                type: 'initState',
                mode: result.mode,
                databaseId: result.databaseId,
                containerId: result.containerId,
                documentId: result.documentId,
            });
            if (result.documentContent) {
                this.dispatch({
                    type: 'setDocument',
                    documentContent: JSON.stringify(result.documentContent, null, 4),
                    partitionKey: result.documentPartitionKey ?? emptyPartitionKey,
                });
            }
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
