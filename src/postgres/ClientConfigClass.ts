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

    constructor(config) {
        this.database = config.database;
        this.host = config.host;
        this.password = config.password;
        this.port = config.port;
        this.user = config.user;
        this.ssl = config.ssl;
    }

}
