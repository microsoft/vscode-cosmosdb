/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitest/config';
import base from './vitest.config';

export default defineConfig({
    ...base,
    test: {
        ...base.test,
        include: ['src/panels/accountOverview/services/advisories/conformance/coda.conformance.ts'],
        fileParallelism: false,
        maxWorkers: 1,
    },
});
