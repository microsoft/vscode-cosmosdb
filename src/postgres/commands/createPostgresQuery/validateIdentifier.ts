/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function validateIdentifier(identifier: string): string | undefined {
    // Identifier naming rules: https://aka.ms/AA8618j
    identifier = identifier.trim();

    const min = 1;
    const max = 63;

    if (identifier.length < min || identifier.length > max) {
        return vscode.l10n.t('The name must be between {0} and {1} characters.', min, max);
    }

    if (!identifier[0].match(/[a-z_]/i)) {
        return vscode.l10n.t('Name must start with a letter or underscore.');
    }

    if (identifier.match(/[^a-z_\d$]/i)) {
        return vscode.l10n.t('Name can only contain letters, underscores, digits (0-9), and dollar signs ($).');
    }

    if (reservedWords.has(identifier.toLowerCase())) {
        return vscode.l10n.t('Name cannot be reserved word "{0}".', identifier);
    }

    return undefined;
}

// Key words that are reserved in PostgreSQL. Source: https://www.postgresql.org/docs/10/sql-keywords-appendix.html
const reservedWords: Set<string> = new Set([
    'all',
    'analyse',
    'analyze',
    'and',
    'any',
    'array',
    'as',
    'asc',
    'asymmetric',
    'both',
    'case',
    'cast',
    'check',
    'collate',
    'column',
    'constraint',
    'create',
    'current_catalog',
    'current_date',
    'current_role',
    'current_time',
    'current_timestamp',
    'current_user',
    'default',
    'deferrable',
    'desc',
    'distinct',
    'do',
    'else',
    'end',
    'except',
    'false',
    'fetch',
    'for',
    'foreign',
    'from',
    'grant',
    'group',
    'having',
    'in',
    'initially',
    'intersect',
    'into',
    'lateral',
    'leading',
    'limit',
    'localtime',
    'localtimestamp',
    'not',
    'null',
    'offset',
    'on',
    'only',
    'or',
    'order',
    'placing',
    'primary',
    'references',
    'returning',
    'select',
    'session_user',
    'some',
    'symmetric',
    'table',
    'then',
    'to',
    'trailing',
    'true',
    'union',
    'unique',
    'user',
    'using',
    'variadic',
    'when',
    'where',
    'window',
    'with',
]);
