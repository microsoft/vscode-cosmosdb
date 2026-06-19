/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
    COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH,
    COSMOS_DB_ACCOUNT_NAME_MIN_LENGTH,
    sanitizeCosmosDBAccountName,
    validateCosmosDBAccountName,
} from './cosmosDBAccountName';

describe('validateCosmosDBAccountName', () => {
    it('accepts a typical valid name', () => {
        expect(validateCosmosDBAccountName('my-cosmos-account-1')).toBeUndefined();
    });

    it('accepts the minimum-length name', () => {
        expect(validateCosmosDBAccountName('a1b')).toBeUndefined();
    });

    it('accepts the maximum-length name', () => {
        const name = 'a' + 'b'.repeat(COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH - 2) + 'c';
        expect(name.length).toBe(COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH);
        expect(validateCosmosDBAccountName(name)).toBeUndefined();
    });

    it('rejects an empty name', () => {
        expect(validateCosmosDBAccountName('')).toBe('Account name is required.');
    });

    it('rejects a name shorter than the minimum', () => {
        const message = validateCosmosDBAccountName('ab');
        expect(message).toContain(String(COSMOS_DB_ACCOUNT_NAME_MIN_LENGTH));
    });

    it('rejects a name longer than the maximum', () => {
        const tooLong = 'a'.repeat(COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH + 1);
        const message = validateCosmosDBAccountName(tooLong);
        expect(message).toContain(String(COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH));
    });

    it('rejects uppercase letters and other illegal characters', () => {
        expect(validateCosmosDBAccountName('MyAccount')).toBe(
            'Account name may contain only lowercase letters, numbers, and hyphens.',
        );
        expect(validateCosmosDBAccountName('my_account')).toBe(
            'Account name may contain only lowercase letters, numbers, and hyphens.',
        );
    });

    it('rejects a name that does not start with a letter or number', () => {
        expect(validateCosmosDBAccountName('-account')).toBe(
            'Account name must start with a lowercase letter or number.',
        );
    });

    it('rejects a name that does not end with a letter or number', () => {
        expect(validateCosmosDBAccountName('account-')).toBe(
            'Account name must end with a lowercase letter or number.',
        );
    });
});

describe('sanitizeCosmosDBAccountName', () => {
    it('returns undefined for empty / nullish input', () => {
        expect(sanitizeCosmosDBAccountName('')).toBeUndefined();
        expect(sanitizeCosmosDBAccountName(null)).toBeUndefined();
        expect(sanitizeCosmosDBAccountName(undefined)).toBeUndefined();
    });

    it('lowercases and replaces illegal characters with hyphens', () => {
        expect(sanitizeCosmosDBAccountName('My Project Name')).toBe('my-project-name');
        expect(sanitizeCosmosDBAccountName('Hello_World!')).toBe('hello-world');
    });

    it('collapses runs of hyphens and trims leading/trailing ones', () => {
        expect(sanitizeCosmosDBAccountName('--a   b__c--')).toBe('a-b-c');
    });

    it('produces a name that passes validation', () => {
        const sanitized = sanitizeCosmosDBAccountName('My Cosmos DB Project (2026)');
        expect(sanitized).toBeDefined();
        expect(validateCosmosDBAccountName(sanitized!)).toBeUndefined();
    });

    it('truncates over-long names and re-trims exposed trailing hyphens', () => {
        const input = 'a'.repeat(COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH) + '-tail';
        const sanitized = sanitizeCosmosDBAccountName(input);
        expect(sanitized).toBe('a'.repeat(COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH));
        expect(sanitized!.length).toBe(COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH);
    });

    it('re-trims a trailing hyphen exposed exactly at the truncation boundary', () => {
        // 43 'a's, then '-', then more letters: truncating to 44 leaves a trailing hyphen.
        const input = 'a'.repeat(COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH - 1) + '-bbbb';
        const sanitized = sanitizeCosmosDBAccountName(input);
        expect(sanitized).toBe('a'.repeat(COSMOS_DB_ACCOUNT_NAME_MAX_LENGTH - 1));
    });

    it('returns undefined when the result collapses below the minimum length', () => {
        expect(sanitizeCosmosDBAccountName('!!')).toBeUndefined();
        expect(sanitizeCosmosDBAccountName('a!')).toBeUndefined();
    });
});
