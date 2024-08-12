/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';

export async function commandSucceeds(command: string, ...args: string[]): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
        cp.spawn(command, args)
            .on('error', (_error) => resolve(false))
            .on('exit', (code) => resolve(code === 0));
    });
}
