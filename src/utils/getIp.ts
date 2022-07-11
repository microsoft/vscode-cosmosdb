/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { sendRequestWithTimeout } from '@microsoft/vscode-azext-azureutils';
import { IActionContext } from '@microsoft/vscode-azext-utils';
import { Resolver } from 'dns';
import { isIPv4 } from 'net';
import { localize } from './localize';

export async function getPublicIpv4(context: IActionContext): Promise<string> {
    const methods: (() => Promise<string>)[] = [
        () => getPublicIpv4Dns(),
        () => getPublicIpv4Https(context, 'https://api.ipify.org/'),
        () => getPublicIpv4Https(context, 'https://icanhazip.com/'),
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

const failedToGetIp = localize('failedToGetIp', 'Failed to get public IP');

async function getPublicIpv4Dns(): Promise<string> {
    const resolver = new Resolver();
    // Must use OpenDNS's name servers
    resolver.setServers(['208.67.222.222', '208.67.220.220']);

    return new Promise((resolve, reject) => {
        resolver.resolve4('myip.opendns.com.', (err, addresses) => {

            if (err) {
                reject(err);
            }

            if (!isIPv4(addresses[0])) {
                reject(failedToGetIp);
            }

            resolve(addresses[0]);
        });
    });
}

async function getPublicIpv4Https(context: IActionContext, url: string): Promise<string> {
    const req = await sendRequestWithTimeout(context, {
        method: 'GET',
        url,
    }, 5000, undefined);

    const ip = req.bodyAsText;

    if (!ip || !isIPv4(ip)) {
        throw new Error(failedToGetIp);
    }

    return ip;
}
