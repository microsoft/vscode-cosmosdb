/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import { validOnTimeoutOrException } from '../src/utils/inputValidation';

suite("inputValidation Tests", () => {

    suite("validOnTimeoutOrException", () => {

        test("executed", async () => {
            let value = await validOnTimeoutOrException(async () => {
                return await new Promise<string | undefined>((resolve, reject) => {
                    setTimeout(() => { resolve("invalid input"); }, 1);
                });
            });

            assert.equal(value, "invalid input");
        });

        test("timed out",
            async () => {
                let value = await validOnTimeoutOrException(async () => {
                    return await new Promise<string | undefined>((resolve, reject) => {
                        setTimeout(() => { resolve("invalid input"); }, 1000);
                    });
                },
                    1);

                assert.equal(value, undefined);
            });

        test("exception", async () => {
            let value = await validOnTimeoutOrException(async () => {
                return await new Promise<string | undefined>((resolve, reject) => {
                    setTimeout(() => { reject("Oh, boy"); }, 1);
                });
            });

            assert.equal(value, undefined);
        });

    });

});

