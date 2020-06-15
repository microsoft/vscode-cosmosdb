/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from "../../../utils/localize";

export function validateIdentifier(identifier: string): string | undefined {
    // Identifier naming rules: https://aka.ms/AA8618j
    identifier = identifier.trim();

    if (!identifier) {
        return localize('cannotBeEmpty', 'Name cannot be empty.');
    }

    if (!identifier[0].match(/[a-z_]/i)) {
        return localize('mustStartWithLetterOrUnderscore', 'Name must start with a letter or underscore.');
    }

    if (identifier.match(/[^a-z_\d$]/i)) {
        return localize('canOnlyContainCertainCharacters', 'Name can only contain letters, underscores, digits (0-9), and dollar signs ($).');
    }

    return undefined;
}
