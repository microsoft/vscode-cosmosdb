/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type WebviewApi } from 'vscode-webview';
import { isTransportMessage, type Transport, type TransportMessage } from './Transport';

export class WebviewTransport<StateType = unknown> implements Transport {
    public readonly name = 'WebviewTransport';

    private listeners: ((message: TransportMessage) => void)[] = [];

    constructor(private readonly vscodeApi: WebviewApi<StateType>) {
        window.addEventListener('message', (event) => this.handleMessage(event.data));
    }

    post(message: TransportMessage): PromiseLike<boolean> {
        this.vscodeApi.postMessage(message);
        return Promise.resolve(true); // Can't actually know if the message was sent
    }

    on(callback: (message: TransportMessage) => void): void {
        this.listeners.push(callback);
    }

    off(callback: (message: TransportMessage) => void): void {
        this.listeners = this.listeners.filter((cb) => cb !== callback);
    }

    dispose(): void {
        this.listeners = [];
    }

    private handleMessage(msg: unknown): void {
        try {
            if (!isTransportMessage(msg)) {
                console.warn(`[WebviewTransport] Received message that is not a transport message`, msg);
                return;
            }

            const message = msg as TransportMessage;
            this.listeners.forEach((cb) => {
                // One callback throwing an error should not prevent other callbacks from being called
                try {
                    cb(message);
                } catch (error) {
                    console.error(`[WebviewTransport] Error occurred calling callback`, error);
                }
            });
        } catch (error) {
            console.error(`[WebviewTransport] Error occurred handling received message`, error);
        }
    }
}
