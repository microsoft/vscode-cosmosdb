/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeUtil from '../../utils/vscodeUtils';

export async function createMongoSrapbook(): Promise<void> {
    await vscodeUtil.showNewFile('', 'Scrapbook', '.mongo');
}
