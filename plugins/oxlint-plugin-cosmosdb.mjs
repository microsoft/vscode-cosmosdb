/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import licenseHeader from './oxlint-rules/license-header.mjs';
import noRestrictedSyntax from './oxlint-rules/no-restricted-syntax.mjs';

export default {
    meta: { name: 'cosmosdb' },
    rules: {
        'license-header': licenseHeader,
        'no-restricted-syntax': noRestrictedSyntax,
    },
};
