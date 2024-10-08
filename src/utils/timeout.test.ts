/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { rejectOnTimeout, valueOnTimeout } from './timeout';

describe('timeout Tests', () => {
    describe('rejectOnTimeout', () => {
        it('executes synchronously', async () => {
            let executed: boolean = false;

            await rejectOnTimeout(1, () => {
                executed = true;
            });

            expect(executed).toBe(true);
        });

        it('executes synchronously in promise', async () => {
            let executed = false;

            await rejectOnTimeout(1, () => {
                return new Promise<void>((resolve, _reject) => {
                    executed = true;
                    resolve();
                });
            });

            expect(executed).toBe(true);
        });

        it('executes asynchronously before time-out', async () => {
            let executed = false;

            await rejectOnTimeout(1000, () => {
                return new Promise<void>((resolve, _reject) => {
                    setTimeout(() => {
                        executed = true;
                        resolve();
                    }, 1);
                });
            });

            expect(executed).toBe(true);
        });

        it('timed out', async () => {
            let executed = false;

            await expect(
                rejectOnTimeout(1, async () => {
                    await new Promise<void>((resolve, _reject) => {
                        setTimeout(() => {
                            executed = true;
                            resolve();
                        }, 1000);
                    });
                }),
            ).rejects.toThrow('Execution timed out');

            expect(executed).toBe(false);
        });

        it('throws before time-out', async () => {
            const executed = false;
            let error: Error = new Error("I haven't thrown up yet");

            try {
                await rejectOnTimeout(1000, async () => {
                    await new Promise((_resolve, _reject) => {
                        throw new Error('I threw up');
                    });
                });
            } catch (err) {
                error = err;
            }

            expect(executed).toBe(false);
            expect(error.message).toEqual('I threw up');
        });
    });

    describe('valueOnTimeout', () => {
        it('executed', async () => {
            const value = await valueOnTimeout(1000, 123, async () => {
                return await new Promise<number>((resolve, _reject) => {
                    setTimeout(() => {
                        resolve(-123);
                    }, 1);
                });
            });

            expect(value).toEqual(-123);
        });

        it('timed out', async () => {
            const value = await valueOnTimeout(1, 123, async () => {
                return await new Promise<number>((resolve, _reject) => {
                    setTimeout(() => {
                        resolve(-123);
                    }, 1000);
                });
            });

            expect(value).toEqual(123);
        });

        it('reject', async () => {
            await expect(
                valueOnTimeout(1000, 123, async () => {
                    return await new Promise<number>((_resolve, reject) => {
                        setTimeout(() => {
                            reject(new Error('rejected'));
                        }, 1);
                    });
                }),
            ).rejects.toThrow('rejected');
        });
    });
});
