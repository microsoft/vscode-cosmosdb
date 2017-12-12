/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
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