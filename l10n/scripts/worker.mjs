/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getL10nJson } from '@vscode/l10n-dev';
import { parentPort } from 'node:worker_threads';

parentPort.on('message', async (fileContents) => {
    try {
        const result = await getL10nJson(fileContents);
        parentPort.postMessage({ ok: true, result });
    } catch (err) {
        parentPort.postMessage({ ok: false, error: err.message });
    }
});

