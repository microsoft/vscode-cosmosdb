/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';

export function improveError(error: unknown): unknown {
    const message = parseError(error).message;
    // Example: "spawn c:\Program Files\MongoDB\Server\4.0\bin\mongo.exe ENOENT"
    const match = message.match(/spawn (.*) ENOENT/);
    if (match) {
        return new Error(l10n.t('Could not find {0}', match[1]));
    }

    return error;
}
