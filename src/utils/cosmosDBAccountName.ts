/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

/**
 * Azure Cosmos DB account name rules (from the ARM naming rules and the Cosmos DB
 * account creation API):
 *
 *   - 3 to 44 characters in length
 *   - Lowercase letters, numbers, and hyphens (`-`) only
 *   - Must start with a lowercase letter or number
 *   - Must not end with a hyphen
 *
 * See:
 *   https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules#microsoftdocumentdb
 *   https://learn.microsoft.com/azure/cosmos-db/account-databases-containers-items#azure-cosmos-db-account
 *
 * The rules are also enforced server-side by Azure; this helper provides
 * client-side validation and a best-effort normalization of arbitrary strings
 * (e.g. a user's project name) into a compliant default.
 */

export const COSMOS_DB_ACCOUNT_NAME_MIN_LENGTH = 3;
export const COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH = 44;

/**
 * Regex matching a fully-valid Cosmos DB account name. Anchored on both ends.
 * Splitting this into pieces keeps the validation rules individually checkable
 * (see `validateCosmosDBAccountName`).
 */
const VALID_ACCOUNT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,42}[a-z0-9]$/;

/**
 * Validates a Cosmos DB account name. Returns `undefined` when the name is
 * valid, or a localized human-readable error describing the first violation
 * otherwise.
 */
export function validateCosmosDBAccountName(name: string): string | undefined {
    if (!name) {
        return l10n.t('Account name is required.');
    }

    if (name.length < COSMOS_DB_ACCOUNT_NAME_MIN_LENGTH) {
        return l10n.t('Account name must be at least {0} characters long.', COSMOS_DB_ACCOUNT_NAME_MIN_LENGTH);
    }

    if (name.length > COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH) {
        return l10n.t('Account name must be at most {0} characters long.', COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH);
    }

    if (!/^[a-z0-9-]+$/.test(name)) {
        return l10n.t('Account name may contain only lowercase letters, numbers, and hyphens.');
    }

    if (!/^[a-z0-9]/.test(name)) {
        return l10n.t('Account name must start with a lowercase letter or number.');
    }

    if (!/[a-z0-9]$/.test(name)) {
        return l10n.t('Account name must end with a lowercase letter or number.');
    }

    // Final belt-and-braces check; the individual checks above should cover
    // every case but this guards against drift between the regex and the
    // rules list.
    if (!VALID_ACCOUNT_NAME_PATTERN.test(name)) {
        return l10n.t('Account name is invalid.');
    }

    return undefined;
}

/**
 * Best-effort normalization of an arbitrary string into a Cosmos DB account
 * name: lowercases, replaces every unsupported character with a hyphen,
 * collapses runs of hyphens, and trims leading/trailing hyphens.
 *
 * Also enforces the 3-44 character bound:
 *   - Strings longer than 44 chars are truncated (and re-trimmed of trailing
 *     hyphens, which might have been exposed by the truncation).
 *   - Strings that collapse below 3 chars return `undefined` — the caller
 *     should treat that as "no usable default" rather than inventing one.
 */
export function sanitizeCosmosDBAccountName(input: string | null | undefined): string | undefined {
    if (!input) {
        return undefined;
    }

    let result = input
        .toLowerCase()
        // Replace every char that is not a lowercase letter, digit, or hyphen with a hyphen.
        .replace(/[^a-z0-9-]+/g, '-')
        // Collapse runs of hyphens.
        .replace(/-+/g, '-')
        // Trim leading hyphens so the name starts with a letter/digit.
        .replace(/^-+/, '')
        // Trim trailing hyphens so the name ends with a letter/digit.
        .replace(/-+$/, '');

    if (result.length > COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH) {
        result = result.slice(0, COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH).replace(/-+$/, '');
    }

    if (result.length < COSMOS_DB_ACCOUNT_NAME_MIN_LENGTH) {
        return undefined;
    }

    return result;
}
