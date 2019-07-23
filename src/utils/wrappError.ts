/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { parseError } from "vscode-azureextensionui";

export function wrapError(outer?: unknown, innerError?: unknown): unknown {
    if (!innerError) {
        return outer;
    } else if (!outer) {
        return innerError;
    }

    let innerMessage = parseError(innerError).message;
    if (outer instanceof Error) {
        outer.message = `${outer.message}${os.EOL}${innerMessage}`;
        return outer;
    }

    return new Error(`${parseError(outer).message}${os.EOL}${innerMessage}`);
}
