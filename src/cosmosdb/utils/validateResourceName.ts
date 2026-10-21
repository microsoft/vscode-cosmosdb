/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

// Validate the exact name to be submitted; callers that trim input must do so before validation.
// https://learn.microsoft.com/azure/cosmos-db/concepts-limits#per-container-limits
// https://learn.microsoft.com/dotnet/api/microsoft.azure.cosmos.containerproperties.id#remarks
// Trailing whitespace matches Data Explorer's rule: https://github.com/Azure/cosmos-explorer/blob/master/src/Utils/ValidationUtils.ts
export function validateContainerName(name: string): string | undefined {
    if (!name.trim()) return l10n.t('Container name is required.');
    if (/\s$/.test(name)) return l10n.t('Container name cannot end with whitespace.');
    if (/[/\\?#]/.test(name)) {
        return l10n.t("Container name cannot contain the characters '\\', '/', '#', '?'");
    }
    if (name.length > 255) return l10n.t('Container name cannot be longer than 255 characters');
    return undefined;
}

export function validateDatabaseName(name: string): string | undefined {
    if (!name.trim()) return l10n.t('Database name is required.');
    if (/\s$/.test(name)) return l10n.t('Database name cannot end with whitespace.');
    // Preserve the extension's additional database-name restriction on "=".
    if (/[/\\?#=]/.test(name)) {
        return l10n.t("Database name cannot contain the characters '\\', '/', '#', '?', '='");
    }
    if (name.length > 255) return l10n.t('Database name cannot be longer than 255 characters');
    return undefined;
}
