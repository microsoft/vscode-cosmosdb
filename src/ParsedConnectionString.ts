/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export abstract class ParsedConnectionString {
    public abstract readonly hostName: string;
    public abstract readonly port: string;

    /**
     * databaseName may be undefined if this is an account-level connection string
     */
    public readonly databaseName: string | undefined;
    public readonly connectionString: string;

    constructor(connectionString: string, databaseName: string | undefined) {
        this.connectionString = connectionString;
        this.databaseName = databaseName;
    }

    public get accountId(): string {
        return `${this.hostName}:${this.port}`;
    }

    public get accountName(): string {
        return this.accountId;
    }

    public get fullId(): string {
        return `${this.accountId}${this.databaseName ? '/' + this.databaseName : ''}`;
    }
}
