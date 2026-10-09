/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { assertProvisioningAuthorized } from './provisioningAuthorization';

describe('provisioningAuthorization', () => {
    it('rejects missing and false authorization', () => {
        expect(() => assertProvisioningAuthorized(undefined)).toThrow(/explicit invocation authorization/u);
        expect(() => assertProvisioningAuthorized({ allowProvisioning: false })).toThrow(
            /explicit invocation authorization/u,
        );
    });

    it('accepts explicit invocation authorization', () => {
        expect(() => assertProvisioningAuthorized({ allowProvisioning: true })).not.toThrow();
    });
});
