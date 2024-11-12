/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuid } from 'uuid';
import { type Transport, type TransportMessage } from '../Transport/Transport';
import {
    isChannelPayload,
    type Channel,
    type ChannelCallback,
    type ChannelMessage,
    type ChannelPayload,
} from './Channel';
import { Deferred, type DeferredPromise } from './DeferredPromise';

type ListenerCallback = {
    type: 'on' | 'once';
    callback: ChannelCallback;
    calledTimes?: number;
};
type Request = {
    expiresAt: number;
    deferred: DeferredPromise<unknown>;
};

type ErrorWithMessage = {
    message: string;
};

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
    return (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as Record<string, unknown>).message === 'string'
    );
}

function toErrorWithMessage(maybeError: unknown): ErrorWithMessage {
    if (isErrorWithMessage(maybeError)) return maybeError;

    try {
        return new Error(JSON.stringify(maybeError));
    } catch {
        // fallback in case there's an error stringifying the maybeError
        // like with circular references for example.
        return new Error(String(maybeError));
    }
}

export function getErrorMessage(error: unknown) {
    return toErrorWithMessage(error).message;
}

export class CommonChannel implements Channel {
    private listeners: Record<string, ListenerCallback[]> = {};
    private pendingRequests: Record<string, Request> = {};

    private readonly handleMessageInternal: (msg: TransportMessage) => void;
    private readonly timeoutId: NodeJS.Timeout;

    private isDisposed = false;

    constructor(
        public readonly name: string,
        public readonly transport: Transport,
    ) {
        this.handleMessageInternal = (msg: TransportMessage) => this.handleMessage(msg);
        this.transport.on(this.handleMessageInternal);

        // Clean up pending requests every 500ms (we don't expect a lot of requests and accuracy is not critical)
        this.timeoutId = setInterval(() => {
            const now = Date.now();
            Object.entries(this.pendingRequests).forEach(([id, request]) => {
                if (request.expiresAt < now) {
                    request.deferred.reject(new Error(`Request timed out`));
                    delete this.pendingRequests[id];
                }
            });
        }, 500);
    }

    postMessage(message: ChannelPayload): PromiseLike<unknown>;
    postMessage(message: ChannelMessage): PromiseLike<unknown>;
    postMessage(message: ChannelMessage | ChannelPayload): PromiseLike<unknown> {
        if (this.isDisposed) {
            return Promise.reject(new Error('Channel disposed'));
        }

        const now = Date.now();
        const id = 'id' in message ? message.id : uuid();
        const payload = 'id' in message ? message.payload : message;

        if (payload.type === 'request') {
            const deferred = new Deferred();
            this.pendingRequests[id] = { expiresAt: now + 15000, deferred };
            // Automatically remove pending request from the list to clean up memory
            void deferred.promise.then(
                () => delete this.pendingRequests[id],
                () => delete this.pendingRequests[id],
            );
        }

        void this.transport.post({ id, payload });

        return this.pendingRequests[id]?.deferred.promise ?? Promise.resolve(true);
    }

    on(event: string, callback: ChannelCallback): Channel {
        if (this.isDisposed) {
            return this;
        }

        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push({ type: 'on', callback, calledTimes: 0 });

        return this;
    }

    once(event: string, callback: ChannelCallback): Channel {
        if (this.isDisposed) {
            return this;
        }

        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push({ type: 'once', callback, calledTimes: 0 });

        return this;
    }

    off(event: string, callback: ChannelCallback): Channel {
        if (this.isDisposed) {
            return this;
        }

        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((cb) => cb.callback !== callback);
        }

        return this;
    }

    removeAllListeners(event?: string): Channel {
        if (this.isDisposed) {
            return this;
        }

        if (event) {
            delete this.listeners[event];
        } else {
            this.listeners = {};
        }

        return this;
    }

    dispose(): void {
        this.isDisposed = true;

        // Clean up listeners first to avoid any messages being processed
        this.listeners = {};

        // since the transport is shared, we don't dispose it here
        this.transport.off(this.handleMessageInternal);

        // Clean up pending requests
        clearTimeout(this.timeoutId);
        Object.values(this.pendingRequests).forEach((request) => {
            request.deferred.reject(new Error('Channel disposed'));
        });

        this.pendingRequests = {};
    }

    private handleMessage(msg: TransportMessage): void {
        try {
            if (typeof msg.payload !== 'object' || !msg.payload || !isChannelPayload(msg.payload)) {
                console.warn('Received message with unknown payload', msg);
                return;
            }

            const payload = msg.payload as ChannelPayload;

            if (payload.type === 'response' || payload.type === 'error') {
                const request = this.pendingRequests[msg.id];
                if (!request) {
                    console.warn('Received response for unknown request', msg);
                    return;
                }

                if (payload.type === 'response') {
                    request.deferred.resolve(payload.value);
                } else {
                    request.deferred.reject(new Error(payload.message));
                }

                delete this.pendingRequests[msg.id];
            }

            if (payload.type === 'event' || payload.type === 'request') {
                const callbacks = this.listeners[payload.name];

                callbacks.forEach((cb) => {
                    // One callback throwing an error should not prevent other callbacks from being called
                    try {
                        cb.calledTimes ??= 0;
                        cb.calledTimes++;

                        if (cb.type === 'once' && cb.calledTimes > 1) {
                            return;
                        }

                        void Promise.resolve(cb.callback.call(undefined, ...payload.params))
                            .then((returnValue) => {
                                if (payload.type === 'request') {
                                    void this.postMessage({
                                        id: msg.id,
                                        payload: { type: 'response', value: returnValue },
                                    });
                                }
                            })
                            .catch((error) => {
                                if (payload.type === 'request') {
                                    void this.postMessage({
                                        id: msg.id,
                                        payload: { type: 'error', message: getErrorMessage(error) },
                                    });
                                }
                            })
                            .finally(() => {
                                if (cb.type === 'once') {
                                    this.off(payload.name, cb.callback);
                                }
                            });
                    } catch (error) {
                        const errorMessage = getErrorMessage(error);
                        console.error(`[VSCodeTransport] Error occurred calling callback`, errorMessage);
                    }
                });
            }
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            if (this.pendingRequests[msg.id]) {
                this.pendingRequests[msg.id].deferred.reject(
                    new Error(`Error occurred handling received message : ${errorMessage}`),
                );
            }
            console.error(errorMessage);
        }
    }
}
