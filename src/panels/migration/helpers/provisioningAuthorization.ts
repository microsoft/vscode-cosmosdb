/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ProvisioningAuthorization {
    allowProvisioning: boolean;
}

export function assertProvisioningAuthorized(authorization: ProvisioningAuthorization | undefined): void {
    if (authorization?.allowProvisioning !== true) {
        throw new Error('Provisioning mutations require explicit invocation authorization.');
    }
}
