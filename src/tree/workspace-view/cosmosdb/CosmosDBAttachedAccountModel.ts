/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type CosmosDBAttachedAccountModel = {
    connectionString: string;
    id: string;
    storageId: string;
    isEmulator: boolean;
    managedEmulator?: boolean;
    managedEmulatorCertificate?: string;
    name: string;
    tenantId?: string;
};
