/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ClientConfig } from 'pg';

export class ClientConfigClass implements ClientConfig {

    public database: string;
    public host: string;
    public password: string;
    public port: number;
    public user: string;
    public ssl: boolean;

    constructor(host) {
        this.host = host;
        this.port = 5432;
    }
    public setDatabase(databaseName) {
        this.database = databaseName;
    }
    public setCredentials(config) {
        this.user = config.user;
        this.password = config.password;
    }
    public setSSLConfig(ssl) {
        this.ssl = ssl;
    }
    public getConfig(): Object {
        return {
            database: this.database,
            host: this.host,
            password: this.password,
            port: this.port,
            user: this.user,
            ssl: this.ssl
        };
    }

}
