/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

export class OperationParser {
    /**
     * Generate operation suggestions based on current context
     */
    public static generateSuggestions(hasConnection: boolean): string {
        if (!hasConnection) {
            return '\n\n' + l10n.t('💡 **Tip:** Open a query editor to get started with AI-powered query assistance.');
        }

        return '\n\n' + l10n.t('💡 **Tip:** Try `/editQuery`, `/explainQuery`, or `/generateQuery` for AI assistance.');
    }
}
