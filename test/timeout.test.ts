/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { rejectOnTimeout, valueOnTimeout } from '../extension';

suite("timeout Tests", () => {
    suite("rejectOnTimeout", () => {

        test("executes synchronously", async () => {
            let executed: boolean = false;

            await rejectOnTimeout(1, () => {
                executed = true;
            });

            assert.equal(executed, true);
        });

        test("executes synchronously in promise", async () => {
            let executed = false;

            await rejectOnTimeout(1, () => {
                return new Promise((resolve, _reject) => {
                    executed = true;
                    resolve();
                });
            })

            assert.equal(executed, true);
        });

        test("executes asynchnously before time-out", async () => {
            let executed = false;

            await rejectOnTimeout(1000, () => {
                return new Promise((resolve, _reject) => {
                    setTimeout(() => {
                        executed = true;
                        resolve();
                    }, 1);
                });
            })
            assert.equal(executed, true);
        });

        test("timed out", async () => {
            let executed = false;

            try {
                await rejectOnTimeout(1, async () => {
                    await new Promise((resolve, _reject) => {
                        setTimeout(() => {
                            executed = true;
                            resolve();
                        }, 1000);
                    });
                });

                assert.fail(null, null, "Expected exception");
            } catch (error) {
            }

            assert.equal(executed, false);
        });

        test("throws before time-out", async () => {
            let executed = false;
            let error: Error = new Error("I haven't thrown up yet");;

            try {
                await rejectOnTimeout(1000, async () => {
                    await new Promise((_resolve, _reject) => {
                        throw new Error("I threw up");
                    });
                })
            } catch (err) {
                error = err;
            }

            assert.equal(executed, false);
            assert.equal(error.message, "I threw up");
        });
    });

    suite("valueOnTimeout", () => {

        test("executed", async () => {
            let value = await valueOnTimeout(1000, 123, async () => {
                return await new Promise<number>((resolve, _reject) => {
                    setTimeout(() => { resolve(-123); }, 1);
                });
            });

            assert.equal(value, -123);
        });

        test("timed out", async () => {
            let value = await valueOnTimeout(1, 123, async () => {
                return await new Promise<number>((resolve, _reject) => {
                    setTimeout(() => { resolve(-123); }, 1000);
                });
            });

            assert.equal(value, 123);
        });

        test("reject", async () => {
            let error;
            try {
                await valueOnTimeout(1000, 123, async () => {
                    return await new Promise<number>((_resolve, reject) => {
                        setTimeout(() => { reject(new Error("rejected")); }, 1);
                    });
                });
            } catch (err) {
                error = err;
            }

            assert.equal(error && error.message, "rejected");
        });
    });

});
