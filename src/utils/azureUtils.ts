/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

export function getDatabaseAccountNameFromId(id: string): string {
    const matches: RegExpMatchArray | null = id.match(
        /\/subscriptions\/(.*)\/resourceGroups\/(.*)\/providers\/(.*)\/databaseAccounts\/(.*)/,
    );

    if (!matches || matches.length < 5) {
        throw new Error(l10n.t('Invalid Azure Resource Id'));
    }

    return matches[4];
}
