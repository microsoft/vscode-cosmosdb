/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export async function valueOnTimeout<T>(timeoutMs: number, timeoutValue: T, action: () => Promise<T>) {
    try {
        return await throwOnTimeout(timeoutMs, action);
    } catch (error) {
        return timeoutValue;
    }
}

export function throwOnTimeout<T>(timeoutMs: number, action: () => Promise<T>) {
    let hasTimedOut = false;
    let hasValue = false;

    return new Promise<T>(async (resolve, reject) => {
        setTimeout(
            () => {
                if (!hasValue) {
                    hasTimedOut = true;
                    reject("Execution timed out");
                }
            },
            timeoutMs);

        let value = await action();
        if (!hasTimedOut) {
            hasValue = true;
            resolve(value);
        }
    });
}
