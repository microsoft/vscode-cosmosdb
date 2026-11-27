/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Plugin } from 'vite';

export interface CopyTarget {
    src: string;
    dest?: string;
    watchDir?: string;
    transform?: (content: string, source: string) => string | Promise<string>;
}

export function copyStaticAssets(options: { targets: CopyTarget[] }): Plugin;
