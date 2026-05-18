/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TRPCClientError, type TRPCLink } from '@trpc/client';
import { type AnyRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';

export type ErrorHandler = (error: Error) => void;

/**
 * A tRPC link that catches errors from downstream links and forwards them
 * to a handler callback. This mirrors the old channel-based `sendCommand`
 * behavior where errors were automatically caught and shown to the user.
 *
 * Subscriptions are passed through without error interception — they have
 * their own `onError` callbacks.
 */
export function errorLink<TRouter extends AnyRouter>(onError: ErrorHandler): TRPCLink<TRouter> {
    return () => {
        return ({ next, op }) => {
            return observable((observer) => {
                return next(op).subscribe({
                    next(value) {
                        observer.next(value);
                    },
                    error(err: unknown) {
                        // Subscriptions handle their own errors; only intercept queries/mutations
                        if (op.type !== 'subscription') {
                            const error = err instanceof Error ? err : new Error(String(err));
                            onError(error);
                        }
                        observer.error(err as TRPCClientError<TRouter>);
                    },
                    complete() {
                        observer.complete();
                    },
                });
            });
        };
    };
}
