/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { ParsedConnectionString } from './ParsedConnectionString';

// Concrete subclass to exercise the abstract base's getters.
class TestConnectionString extends ParsedConnectionString {
    public readonly hostName: string;
    public readonly port: string;

    constructor(connectionString: string, databaseName: string | undefined, hostName: string, port: string) {
        super(connectionString, databaseName);
        this.hostName = hostName;
        this.port = port;
    }
}

describe('ParsedConnectionString', () => {
    it('stores the connection string and database name', () => {
        const parsed = new TestConnectionString('conn-str', 'mydb', 'localhost', '10255');
        expect(parsed.connectionString).toBe('conn-str');
        expect(parsed.databaseName).toBe('mydb');
    });

    it('builds accountId as host:port', () => {
        const parsed = new TestConnectionString('conn-str', 'mydb', 'localhost', '10255');
        expect(parsed.accountId).toBe('localhost:10255');
    });

    it('mirrors accountName to accountId', () => {
        const parsed = new TestConnectionString('conn-str', 'mydb', 'example.com', '443');
        expect(parsed.accountName).toBe(parsed.accountId);
        expect(parsed.accountName).toBe('example.com:443');
    });

    it('appends the database name to fullId when present', () => {
        const parsed = new TestConnectionString('conn-str', 'mydb', 'localhost', '10255');
        expect(parsed.fullId).toBe('localhost:10255/mydb');
    });

    it('omits the database segment from fullId for account-level strings', () => {
        const parsed = new TestConnectionString('conn-str', undefined, 'localhost', '10255');
        expect(parsed.databaseName).toBeUndefined();
        expect(parsed.fullId).toBe('localhost:10255');
    });
});
