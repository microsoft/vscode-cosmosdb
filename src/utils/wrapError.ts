/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { parseError } from "vscode-azureextensionui";

export function wrapError(outerError?: unknown, innerError?: unknown): unknown {
    if (!innerError) {
        return outerError;
    } else if (!outerError) {
        return innerError;
    }

    let innerMessage = parseError(innerError).message;
    let outerMessage = parseError(outerError).message;
    if (outerError instanceof Error) {
        outerError.message = `${outerError.message}${os.EOL}${innerMessage}`;
        return outerError;
    }

    return new Error(`${outerMessage}${os.EOL}${innerMessage}`);
}
