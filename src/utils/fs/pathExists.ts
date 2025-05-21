/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'node:fs/promises';

export async function pathExists(path: string): Promise<boolean> {
    try {
        await fs.access(path);
        return true; // File exists
    } catch {
        return false; // File does not exist
    }
}
