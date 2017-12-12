/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as myExtension from '../src/extension';

import { makeError } from "../src/utils/makeError";
import { UserCancelledError } from 'vscode-azureextensionui';

suite("makeError Tests", () => {

    function testError(err: Error, expectedMessage: string) {
        assert.ok(err instanceof Error, "Not an error");
        assert.equal(err.message, expectedMessage, "Unexpected message");
    }

    test("Already an error", () => {
        const err = new UserCancelledError();
        let result = makeError(err);
        assert.strictEqual(result, err);
    });

    test("string", () => {
        testError(makeError("hello"), "hello");
    });

    test("Unknown", () => {
        const unknown = "Unknown error";

        testError(makeError(null), unknown);
        testError(makeError(undefined), unknown);
        testError(makeError({}), unknown);
        testError(makeError({ unknownData: "hi" }), unknown);
    });


    test("Has message", () => {
        const message = "error message";
        const err = { message };
        let result = makeError(err);
        testError(result, "error message");
    });

    test("Has string body", () => {
        const message = "The offer should have valid throughput values between 400 and 1000000 inclusive in increments of 100.";
        const err = {
            code: 400,
            body: "{ \"code\":\"BadRequest\",\"message\":\"Message: {\\\"Errors\\\":[\\\"The offer should have valid throughput values between 400 and 1000000 inclusive in increments of 100.\\\"]}\\r\\nActivityId: c11a5bcd-bf76-43c0-b713-b28e423599c4, Request URI: /apps/4c8d65d7-216b-46b4-abb7-52c1a0c7123f/services/36df4f13-26ef-48cf-bc7b-9ab28c345ca3/partitions/68d75b64-4651-4c15-b2a5-fc5550bab323/replicas/131570875506839239p, RequestStats: , SDK: Microsoft.Azure.Documents.Common/1.19.121.4\"}",
            activityId: "c11a5bcd-bf76-43c0-b713-b28e423599c4"
        };
        let result = makeError(err);
        testError(result, message);
    });

    test("Has object body", () => {
        const message = "The offer should have valid throughput values between 400 and 1000000 inclusive in increments of 100.";
        const err = {
            code: 400,
            body: JSON.parse("{ \"code\":\"BadRequest\",\"message\":\"Message: {\\\"Errors\\\":[\\\"The offer should have valid throughput values between 400 and 1000000 inclusive in increments of 100.\\\"]}\\r\\nActivityId: c11a5bcd-bf76-43c0-b713-b28e423599c4, Request URI: /apps/4c8d65d7-216b-46b4-abb7-52c1a0c7123f/services/36df4f13-26ef-48cf-bc7b-9ab28c345ca3/partitions/68d75b64-4651-4c15-b2a5-fc5550bab323/replicas/131570875506839239p, RequestStats: , SDK: Microsoft.Azure.Documents.Common/1.19.121.4\"}"),
            activityId: "c11a5bcd-bf76-43c0-b713-b28e423599c4"
        };
        let result = makeError(err);
        testError(result, message);
    });
});
