/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { isTransportMessage, type Transport, type TransportMessage } from './Transport';

export class VSCodeTransport implements Transport {
    public readonly name = 'VSCodeTransport';

    private listeners: ((message: TransportMessage) => void)[] = [];
    private disposables: vscode.Disposable[] = [];

    constructor(public readonly webview: vscode.Webview) {
        this.webview.onDidReceiveMessage((msg: unknown) => this.handleMessage(msg), this, this.disposables);
    }

    post(message: TransportMessage): PromiseLike<boolean> {
        return this.webview.postMessage(message);
    }

    on(callback: (message: TransportMessage) => void): void {
        this.listeners.push(callback);
    }

    off(callback: (message: TransportMessage) => void): void {
        this.listeners = this.listeners.filter((cb) => cb !== callback);
    }

    dispose(): void {
        this.listeners = [];

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private handleMessage(msg: unknown): void {
        try {
            if (!isTransportMessage(msg)) {
                console.warn('[VSCodeTransport] Received message that is not a transport message', msg);
                return;
            }

            const message = msg as TransportMessage;
            this.listeners.forEach((cb) => {
                // One callback throwing an error should not prevent other callbacks from being called
                try {
                    cb(message);
                } catch (error) {
                    console.error(l10n.t('[VSCodeTransport] Error occurred calling callback'), error);
                }
            });
        } catch (error) {
            // TODO: Telemetry
            console.error(l10n.t('[VSCodeTransport] Error occurred handling received message'), error);
        }
    }
}
