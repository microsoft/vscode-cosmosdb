/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const isTransportMessage = (msg: unknown): msg is TransportMessage => {
    return typeof msg === 'object' && msg !== null && 'id' in msg && 'payload' in msg;
};

export interface TransportMessage {
    id: string; // uuid to connect request and response
    payload: unknown;
}

export interface Transport {
    readonly name: string;

    post(message: TransportMessage): PromiseLike<boolean>;
    on(callback: (message: TransportMessage) => void): void;
    off(callback: (message: TransportMessage) => void): void;
    dispose(): void;
}
