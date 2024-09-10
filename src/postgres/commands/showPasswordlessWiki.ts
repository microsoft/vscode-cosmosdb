/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openUrl } from '../../utils/openUrl';

export async function showPasswordlessWiki(): Promise<void> {
    await openUrl('https://aka.ms/postgresql-passwordless-wiki');
}
