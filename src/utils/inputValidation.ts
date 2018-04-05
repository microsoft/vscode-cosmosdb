/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { valueOnTimeout } from "./timeout";

export const inputValidationTimeoutMs = 2000;

export function validOnTimeout(inputValidation: () => Promise<string | undefined>) {
    return valueOnTimeout(inputValidationTimeoutMs, undefined, inputValidation);
}
