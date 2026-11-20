/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseSuiteFilter } from '@microsoft/vally';

export function resolveEvalSelection(arguments_) {
    const args = [...arguments_];
    if (args.some((arg) => arg === '--in-place' || arg.startsWith('--in-place='))) {
        throw new Error('Migration evaluations must use isolated trial workspaces, not --in-place.');
    }
    const tags = [];
    for (let index = 0; index < args.length; index++) {
        if (args[index] === '--tag') {
            if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--tag requires a value');
            tags.push(args[++index]);
        } else if (args[index].startsWith('--tag=')) {
            tags.push(args[index].slice('--tag='.length));
        }
    }
    if (!parseSuiteFilter(tags).include.category?.includes('integration')) {
        tags.push('category!=integration');
        args.push('--tag', 'category!=integration');
    }
    return { args, filter: parseSuiteFilter(tags) };
}
