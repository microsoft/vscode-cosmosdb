/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const timedOutMessage = "Execution timed out";

/**
 * Returns the result of awaiting a specified action. Rejects if the action throws. Returns timeoutValue if a time-out occurs.
 */
export async function valueOnTimeout<T>(timeoutMs: number, timeoutValue: T, action: () => Promise<T> | T) {
    try {
        return await rejectOnTimeout(timeoutMs, action);
    } catch (err) {
        let error = <{ message?: string }>err;
        if (error && error.message === timedOutMessage) {
            return timeoutValue;
        }

        throw err;
    }
}

/**
 * Returns the result of awaiting a specified action. Rejects if the action throws or if the time-out occurs.
 */
export async function rejectOnTimeout<T>(timeoutMs: number, action: () => Promise<T> | T) {
    return await new Promise<T>(async (resolve, reject) => {
        let timer: NodeJS.Timer | undefined = setTimeout(
            () => {
                timer = undefined;
                reject(new Error(timedOutMessage));
            },
            timeoutMs);

        let value: T;
        let error;

        try {
            value = await action();
            clearTimeout(timer);
            resolve(value);
        } catch (err) {
            error = err;
            clearTimeout(timer);
            reject(error);
        }
    });
}
