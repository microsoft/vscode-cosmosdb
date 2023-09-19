/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Sanitize an the id of a DocDB tree item so it can be safely used in a query string.
 * Learn more at: https://github.com/ljharb/qs#rfc-3986-and-rfc-1738-space-encoding
 */
export function sanitizeId(id: string): string {
    return id.replace(/\+/g, ' ');
}
