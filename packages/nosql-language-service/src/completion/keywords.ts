/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// SQL keyword groups for CosmosDB NoSQL completion
// ---------------------------------------------------------------------------

export const CLAUSE_KEYWORDS = [
    'SELECT',
    'FROM',
    'WHERE',
    'ORDER BY',
    'GROUP BY',
    'OFFSET',
    'LIMIT',
    'JOIN',
    'IN',
    'AS',
];

export const SELECT_MODIFIERS = ['DISTINCT', 'TOP', 'VALUE'];

export const EXPRESSION_KEYWORDS = [
    'AND',
    'OR',
    'NOT',
    'BETWEEN',
    'LIKE',
    'IN',
    'EXISTS',
    'ARRAY',
    'IS',
    'NULL',
    'UNDEFINED',
    'TRUE',
    'FALSE',
    'ASC',
    'DESC',
];

