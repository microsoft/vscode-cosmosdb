/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Returns the result of awaiting a specified action. Rejects if the action throws. Returns timeoutValue if a time-out occurs.
 */
export async function valueOnTimeout<T>(timeoutMs: number, timeoutValue: T, action: () => Promise<T> | T) {
    try {
        return await rejectOnTimeout(timeoutMs, action);
    } catch (error) {
        return timeoutValue;
    }
}

/**
 * Returns the result of awaiting a specified action. Rejects if the action throws or if the time-out occurs.
 */
export async function rejectOnTimeout<T>(timeoutMs: number, action: () => Promise<T> | T) {
    return await new Promise<T>(async (resolve, reject) => {
        let timer: NodeJS.Timer = setTimeout(
            () => {
                timer = null;
                reject(new Error("Execution timed out"));
            },
            timeoutMs);

        let value: T;
        try {
            value = await action();
        } catch (error) {
            reject(error);
        }

        if (timer) {
            clearTimeout(timer);
            resolve(value);
        }
    });
}
