/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTestActionContext } from '@microsoft/vscode-azext-dev';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { isIPv4 } from 'net';
import { getPublicIpv4, isIpInRanges } from '../../extension.bundle';

suite('getPublicIpv4', () => {
    test('get IP', async () => {
        try {
            const context = await createTestActionContext();
            const ip = await getPublicIpv4(context as IActionContext);
            assert(isIPv4(ip), "IP address isn't v4");
        } catch (error) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            assert(false, error.message ?? 'Fail to get IP address');
        }
    });
});

suite('isIpInRanges', function () {
    const ip = '12.34.56.78';
    test('Includes ip at start', function () {
        const ranges = [{ startIpAddress: '12.34.56.78', endIpAddress: '12.34.56.80' }];
        assert(isIpInRanges(ip, ranges));
    });
    test('Includes ip at end', function () {
        const ranges = [{ startIpAddress: '12.34.56.76', endIpAddress: '12.34.56.78' }];
        assert(isIpInRanges(ip, ranges));
    });
    test('Includes ip in range', function () {
        const ranges = [{ startIpAddress: '12.34.56.76', endIpAddress: '12.34.56.80' }];
        assert(isIpInRanges(ip, ranges));
    });
    test('Excludes ip before start', function () {
        const ranges = [{ startIpAddress: '12.34.56.80', endIpAddress: '12.34.56.80' }];
        assert(!isIpInRanges(ip, ranges));
    });
    test('Excludes ip after end', function () {
        const ranges = [{ startIpAddress: '12.34.56.76', endIpAddress: '12.34.56.76' }];
        assert(!isIpInRanges(ip, ranges));
    });
});
