/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getDatabaseAccountNameFromId } from './azureUtils';

describe('getDatabaseAccountNameFromId', () => {
    it('extracts the account name from a full resource id', () => {
        const id =
            '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-rg' +
            '/providers/Microsoft.DocumentDB/databaseAccounts/my-account';
        expect(getDatabaseAccountNameFromId(id)).toBe('my-account');
    });

    it('returns the trailing segment after databaseAccounts even with extra path parts', () => {
        const id =
            '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.DocumentDB/databaseAccounts/acct/sqlDatabases/db';
        // The regex is greedy, so group 4 captures everything after databaseAccounts/.
        expect(getDatabaseAccountNameFromId(id)).toBe('acct/sqlDatabases/db');
    });

    it('throws for an id that does not match the expected shape', () => {
        expect(() => getDatabaseAccountNameFromId('/subscriptions/sub/resourceGroups/rg')).toThrow(
            'Invalid Azure Resource Id',
        );
    });

    it('throws for an empty string', () => {
        expect(() => getDatabaseAccountNameFromId('')).toThrow('Invalid Azure Resource Id');
    });
});
