import { error } from "util";
import { ErrorCodes } from "vscode-languageserver/lib/main";

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Given an object representing an error (e.g. as returned from CosmosDB call, turn it into a proper Error)
 */
export function makeError(errObject: any): Error {
    let message: string;

    if (errObject) {
        if (errObject instanceof Error) {
            return errObject;
        } else if (typeof errObject === "string") {
            return new Error(errObject);
        } else if (errObject.message) {
            message = errObject.message;

            // Handle messages like this from Azure:
            //   ["Errors":["The offer should have valid throughput бн",
            let errorsInMessage = message.match(/"Errors":\["([^"]+)"\]/);
            if (errorsInMessage) {
                let [, firstError] = errorsInMessage;
                message = firstError;
            }
        } else if (errObject.body) {
            let body = errObject.body;
            if (typeof body === "string") {
                try {
                    return makeError(JSON.parse(body));
                } catch (err) {
                }
            } else if (typeof body === "object") {
                return makeError(body);
            }
        }
    }

    message = message || "Unknown error";
    return new Error(message);
}

export class ErrorData {
    public readonly message: string;
    public readonly errorType: string;

    constructor(error: any) {
        if (error instanceof Error) {
            try {
                const parsed = JSON.parse(error.message);
                this.errorType = parsed.Code || parsed.code;
                this.message = parsed.Message || parsed.message;
            } catch (err) {
                this.errorType = error.constructor.name;
                this.message = error.message;
            }
        } else if (typeof (error) === 'object' && error !== null) {
            this.errorType = (<object>error).constructor.name;
            this.message = JSON.stringify(error);
        } else if (error !== undefined && error !== null && error.toString && error.toString().trim() !== '') {
            this.errorType = typeof (error);
            this.message = error.toString();
        } else {
            this.errorType = typeof (error);
            this.message = 'Unknown Error';
        }
    }
}
