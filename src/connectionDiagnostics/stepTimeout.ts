/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class StepTimeoutError extends Error {}

export async function withStepTimeout<T>(
    parent: AbortSignal,
    timeoutMs: number,
    operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
    parent.throwIfAborted();
    const deadline = new AbortController();
    const signal = AbortSignal.any([parent, deadline.signal]);
    const timer = setTimeout(() => deadline.abort(new StepTimeoutError()), timeoutMs);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => {
            const reason: unknown = signal.reason;
            reject(reason instanceof Error ? reason : new Error('Diagnostics cancelled'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([aborted, operation(signal)]);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
    }
}
