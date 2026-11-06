/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '@playwright/test';

test('temporary probe: report a flaky test that passes on retry', () => {
    test.skip(!process.env.CI, 'Temporary CI-only probe for the flaky-test warning.');
    expect(test.info().retry, 'Intentionally fail the first attempt to exercise flaky-test reporting.').toBe(1);
});
