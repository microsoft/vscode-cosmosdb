/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PipelineRequest } from '@azure/core-rest-pipeline';
import * as l10n from '@vscode/l10n';

const timedOutMessage = l10n.t('Execution timed out');

export class TimeoutError extends Error {
    public override readonly name = 'TimeoutError';
}

/**
 * Cancels the action's signal and rejects when any source signal aborts, even if the action ignores cancellation.
 */
export async function withAbortSignals<T>(
    signals: readonly PipelineRequest['abortSignal'][],
    action: (signal: AbortSignal) => Promise<T> | T,
): Promise<T> {
    const controller = new AbortController();
    let abort: (() => void) | undefined;
    try {
        return await new Promise<T>((resolve, reject) => {
            abort = () => {
                const error = new DOMException('This operation was aborted', 'AbortError');
                controller.abort(error);
                reject(error);
            };
            for (const signal of signals) {
                if (signal?.aborted) {
                    abort();
                    return;
                }
                signal?.addEventListener('abort', abort);
            }
            void Promise.resolve()
                .then(() => {
                    controller.signal.throwIfAborted();
                    return action(controller.signal);
                })
                .then(resolve, reject);
        });
    } finally {
        if (abort) {
            for (const signal of signals) {
                signal?.removeEventListener('abort', abort);
            }
        }
    }
}

/**
 * Returns the result of awaiting a specified action. Rejects if the action throws. Returns timeoutValue if a time-out occurs.
 */
export async function valueOnTimeout<T>(timeoutMs: number, timeoutValue: T, action: () => Promise<T> | T): Promise<T> {
    try {
        return await rejectOnTimeout(timeoutMs, action);
    } catch (err) {
        const error = <{ message?: string }>err;
        if (error && error.message === timedOutMessage) {
            return timeoutValue;
        }

        throw err;
    }
}

/**
 * Returns the action's result, or aborts its signal and rejects with TimeoutError when the deadline expires.
 */
export async function rejectOnTimeout<T>(
    timeoutMs: number,
    action: (signal: AbortSignal) => Promise<T> | T,
    callerTimeOutMessage?: string,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const controller = new AbortController();
        let timer: NodeJS.Timeout | undefined = setTimeout(() => {
            timer = undefined;
            reject(new TimeoutError(callerTimeOutMessage || timedOutMessage));
            controller.abort();
        }, timeoutMs);

        // Execute the action and handle the result
        Promise.resolve()
            .then(() => action(controller.signal))
            .then((value) => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                    resolve(value);
                }
            })
            .catch((error) => {
                if (timer !== undefined) {
                    clearTimeout(timer);
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            });
    });
}
