/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface MongoClusterUser {
    id: string;
    name: string;
    type: string;
    properties: {
        user: string;
        provisioningState: string;
    };
    systemData?: {
        createdAt?: string;
        createdBy?: string;
        createdByType?: string;
        lastModifiedAt?: string;
        lastModifiedBy?: string;
        lastModifiedByType?: string;
    };
}
