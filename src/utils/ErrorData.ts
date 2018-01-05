/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export class ErrorData {
    public readonly message: string;
    public readonly errorType: string;

    constructor(error: any) {
        const unknownType = "Error";

        try {
            this.message = "";
            this.errorType = "";

            if (error) {
                // Handle objects from Azure SDK that contain the error information in a "body" field (serialized or not)
                let body = error.body;
                if (body) {
                    if (typeof body === "string") {
                        try {
                            body = JSON.parse(body);
                        } catch (err) {
                        }
                    }

                    if (typeof body === "object") {
                        error = body;
                    }
                }

                if (error instanceof Object && error.constructor !== Object) {
                    this.errorType = error.constructor.name;
                }
                this.errorType = error.Code || error.code || this.errorType;

                if (error.message) {
                    this.message = typeof error.message === "string" ? error.message : error.message.toString();

                    if (this.message.indexOf("{") >= 0) {
                        // Message might be a stringified object
                        try {
                            const parsed = JSON.parse(this.message);
                            this.message = parsed.Message || parsed.message || this.message;
                            this.errorType = parsed.Code || parsed.code || this.errorType;
                        } catch { }
                    }
                } else if (typeof (error) === 'object' && error !== null) {
                    this.message = JSON.stringify(error);
                } else if (error !== undefined && error !== null && error.toString && error.toString().trim() !== '') {
                    this.message = error.toString().trim();
                } else {
                    this.message = "";
                }

                // Handle messages like this from Azure:
                //   ["Errors":["The offer should have valid throughput бн",
                let errorsInMessage = this.message.match(/"Errors":\["([^"]+)"\]/);
                if (errorsInMessage) {
                    let [, firstError] = errorsInMessage;
                    this.message = firstError;
                }
            }
        } finally {
            this.errorType = this.errorType || unknownType;
            this.message = this.message || "Unknown error";
        }
    }
}
