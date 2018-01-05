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

import { ErrorData } from "../src/utils/ErrorData";
import { UserCancelledError } from 'vscode-azureextensionui';

suite("ErrorData Tests", () => {

    function testError(err: any, expectedMessage: string, expectedType: string) {
        const errorData = new ErrorData(err);
        assert.equal(errorData.errorType, expectedType);
        assert.equal(errorData.message, expectedMessage, "Unexpected message");
    }

    test("Already an error", () => {
        const err = new UserCancelledError();
        testError(err, "Operation cancelled.", "UserCancelledError");
    });

    test("stringified message", () => {
        testError({ message: JSON.stringify({ message: "hi", Code: 432 }) }, "hi", "432");
    });

    test("string", () => {
        testError("hello", "hello", "Error");
    });

    test("Unknown", () => {
        const unknownMessage = "Unknown error";
        const unknownType = "Error";

        testError(null, unknownMessage, unknownType);
        testError(undefined, unknownMessage, unknownType);
        testError({}, "{}", unknownType);
        testError({ unknownData: "hi" }, '{"unknownData":"hi"}', unknownType);
    });


    test("Has message", () => {
        const message = "error message";
        const err = { message };
        testError(err, "error message", "Error");
    });

    test("Has string body", () => {
        const message = "The offer should have valid throughput values between 400 and 1000000 inclusive in increments of 100.";
        const err = {
            code: 400,
            body: "{ \"code\":\"BadRequest\",\"message\":\"Message: {\\\"Errors\\\":[\\\"The offer should have valid throughput values between 400 and 1000000 inclusive in increments of 100.\\\"]}\\r\\nActivityId: c11a5bcd-bf76-43c0-b713-b28e423599c4, Request URI: /apps/4c8d65d7-216b-46b4-abb7-52c1a0c7123f/services/36df4f13-26ef-48cf-bc7b-9ab28c345ca3/partitions/68d75b64-4651-4c15-b2a5-fc5550bab323/replicas/131570875506839239p, RequestStats: , SDK: Microsoft.Azure.Documents.Common/1.19.121.4\"}",
            activityId: "c11a5bcd-bf76-43c0-b713-b28e423599c4"
        };
        testError(err, message, "BadRequest");
    });

    test("Has object body", () => {
        const message = "The offer should have valid throughput values between 400 and 1000000 inclusive in increments of 100.";
        const err = {
            code: 400,
            body: JSON.parse("{ \"code\":\"BadRequest\",\"message\":\"Message: {\\\"Errors\\\":[\\\"The offer should have valid throughput values between 400 and 1000000 inclusive in increments of 100.\\\"]}\\r\\nActivityId: c11a5bcd-bf76-43c0-b713-b28e423599c4, Request URI: /apps/4c8d65d7-216b-46b4-abb7-52c1a0c7123f/services/36df4f13-26ef-48cf-bc7b-9ab28c345ca3/partitions/68d75b64-4651-4c15-b2a5-fc5550bab323/replicas/131570875506839239p, RequestStats: , SDK: Microsoft.Azure.Documents.Common/1.19.121.4\"}"),
            activityId: "c11a5bcd-bf76-43c0-b713-b28e423599c4"
        };
        testError(err, message, "BadRequest");
    });
});
