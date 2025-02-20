/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoEmulatorConfiguration } from '../commands/newConnection/MongoEmulatorConfiguration';

export interface IConnectionParams {
    connectionString: string;
    databaseName: string;
    extensionUserAgent: string;
    emulatorConfiguration: MongoEmulatorConfiguration;
}
