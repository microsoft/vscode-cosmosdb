/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sendRequestWithTimeout } from '@microsoft/vscode-azext-azureutils';
import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { isIPv4 } from 'net';

export function isIpInRanges(ip: string, ranges: { startIpAddress: string; endIpAddress: string }[]): boolean {
    const ipNum = ipToNum(ip);
    return ranges.some((range) => {
        const startIpNum = ipToNum(range.startIpAddress);
        const endIpNum = ipToNum(range.endIpAddress);
        return startIpNum <= ipNum && ipNum <= endIpNum;
    });
}

export async function getPublicIpv4(context: IActionContext): Promise<string> | never {
    const methods: (() => Promise<string>)[] = [
        () => getPublicIpv4Https(context, 'https://api.ipify.org/'),
        () => getPublicIpv4Https(context, 'https://ipv4.icanhazip.com/'),
    ];

    let lastError: unknown;
    for (const getIp of methods) {
        try {
            return await getIp();
        } catch (e: unknown) {
            lastError = e;
        }
    }

    throw lastError;
}

const failedToGetIp = l10n.t('Failed to get public IP');

function ipToNum(ip: string) {
    return Number(
        ip
            .split('.')
            .map((d) => ('000' + d).substring(-3))
            .join(''),
    );
}

async function getPublicIpv4Https(context: IActionContext, url: string): Promise<string> {
    const req = await sendRequestWithTimeout(
        context,
        {
            method: 'GET',
            url,
        },
        5000,
        undefined,
    );

    const ip = req.bodyAsText;

    if (!ip || !isIPv4(ip)) {
        throw new Error(failedToGetIp);
    }

    return ip;
}
