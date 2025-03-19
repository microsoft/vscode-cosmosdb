/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

const timedOutMessage = l10n.t('Execution timed out');

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
 * Returns the result of awaiting a specified action. Rejects if the action throws or if the time-out occurs.
 */
export async function rejectOnTimeout<T>(
    timeoutMs: number,
    action: () => Promise<T> | T,
    callerTimeOutMessage?: string,
): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises, no-async-promise-executor
    return await new Promise<T>(async (resolve, reject) => {
        let timer: NodeJS.Timeout | undefined = setTimeout(() => {
            timer = undefined;
            reject(new Error(callerTimeOutMessage || timedOutMessage));
        }, timeoutMs);

        let value: T;
        let error;

        try {
            value = await action();
            clearTimeout(timer);
            resolve(value);
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            error = err;
            clearTimeout(timer);
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            reject(error);
        }
    });
}
