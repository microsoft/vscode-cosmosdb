/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDefaultHttpClient } from '@azure/core-rest-pipeline';
import { CosmosClient } from '@azure/cosmos';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import * as https from 'node:https';
import * as tls from 'node:tls';
import * as vscode from 'vscode';
import { createCosmosHttpClient } from '../src/cosmosdb/createCosmosHttpClient';

export function activate() {}

export async function run() {
    const certificate = await readFile(process.env.COSMOS_PROXY_TEST_CERT);
    const environmentBypass = !!process.env.NO_PROXY;
    const configuration = vscode.workspace.getConfiguration('http');
    const results = [];
    const failures = [];
    for (const mode of ['off', 'on', 'fallback', 'override']) {
        await configuration.update('proxySupport', mode, vscode.ConfigurationTarget.Global);
        for (const scenario of [
            'environment',
            'setting',
            'setting-bypass',
            'setting-precedence',
            'loopback',
            'emulator-localhost',
            'emulator-ipv4',
        ]) {
            const noProxy =
                scenario === 'setting-bypass'
                    ? ['account.proxy-test.invalid']
                    : scenario === 'setting-precedence'
                      ? ['other.invalid']
                      : [];
            await configuration.update(
                'proxy',
                scenario === 'environment' ? '' : process.env.HTTPS_PROXY,
                vscode.ConfigurationTarget.Global,
            );
            await configuration.update('noProxy', noProxy, vscode.ConfigurationTarget.Global);
            assert.equal(vscode.workspace.getConfiguration('http').get('proxySupport'), mode);
            assert.deepEqual(vscode.workspace.getConfiguration('http').get('noProxy'), noProxy);

            for (const transport of ['original', 'vscode-managed']) {
                const isEmulator = scenario.startsWith('emulator-');
                const hostname =
                    scenario === 'emulator-ipv4'
                        ? '127.0.0.1'
                        : scenario === 'loopback' || isEmulator
                          ? 'localhost'
                          : 'account.proxy-test.invalid';
                const agent = new https.Agent({ rejectUnauthorized: !isEmulator });
                const delegate =
                    transport === 'vscode-managed' && !isEmulator
                        ? createCosmosHttpClient()
                        : createDefaultHttpClient();
                const client = new CosmosClient({
                    endpoint: `https://${hostname}:${process.env.COSMOS_PROXY_TEST_PORT}`,
                    key: Buffer.from('local-test-key').toString('base64'),
                    agent,
                    httpClient: {
                        sendRequest(request) {
                            // Keep both paths local even when VS Code replaces the SDK's agent. Trust only the
                            // generated fixture CA; certificate validation stays enabled.
                            request.requestOverrides = {
                                ca: isEmulator ? undefined : certificate,
                                lookup: (_host, options, callback) => {
                                    if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
                                    else callback(null, '127.0.0.1', 4);
                                },
                            };
                            return delegate.sendRequest(request);
                        },
                    },
                    connectionPolicy: {
                        enableEndpointDiscovery: false,
                        requestTimeout: 3000,
                        retryOptions: { maxRetryAttemptCount: 0 },
                    },
                });
                let route;
                try {
                    const response = await client.getDatabaseAccount();
                    assert.equal(response.resource?.consistencyPolicy, 'Strong');
                    route = 'DIRECT';
                } catch (error) {
                    if (error.code === 407) route = 'PROXY';
                    else {
                        route = `ERROR: ${error.code || error.message}`;
                        failures.push(`${mode}/${scenario}/${transport}: ${route}`);
                    }
                } finally {
                    client.dispose();
                    agent.destroy();
                }
                const bypass =
                    scenario === 'loopback' ||
                    isEmulator ||
                    scenario === 'setting-bypass' ||
                    (environmentBypass && scenario !== 'setting-precedence');
                const expected =
                    bypass ||
                    (transport === 'original' && ['off', 'on'].includes(mode)) ||
                    (transport === 'vscode-managed' && mode === 'off')
                        ? 'DIRECT'
                        : 'PROXY';
                const result = {
                    vscode: vscode.version,
                    environmentBypass,
                    mode,
                    scenario,
                    transport,
                    route,
                    expected,
                };
                results.push(result);
                console.log(JSON.stringify(result));
                if (route !== expected) failures.push(JSON.stringify(result));
            }
        }
    }
    if (!environmentBypass) {
        results.push(...(await testTlsValidation(configuration, certificate)));
    }
    await writeFile(process.env.COSMOS_PROXY_TEST_RESULTS, JSON.stringify(results, null, 2));
    assert.deepEqual(failures, [], 'Unexpected proxy routing in extension host');
}

async function testTlsValidation(configuration, destinationCertificate) {
    assert.equal(
        typeof tls.setDefaultCACertificates,
        'function',
        'TLS tests require Node certificate configuration support',
    );
    const proxyCertificate = await readFile(process.env.COSMOS_PROXY_TLS_CERT, 'utf8');
    const originalCertificates = tls.getCACertificates('default');
    const results = [];
    try {
        await configuration.update('proxy', process.env.COSMOS_PROXY_TLS_URL, vscode.ConfigurationTarget.Global);
        await configuration.update('noProxy', [], vscode.ConfigurationTarget.Global);
        for (const mode of ['off', 'on', 'fallback', 'override']) {
            await configuration.update('proxySupport', mode, vscode.ConfigurationTarget.Global);
            for (const strictSSL of [true, false]) {
                await configuration.update('proxyStrictSSL', strictSSL, vscode.ConfigurationTarget.Global);
                assert.equal(vscode.workspace.getConfiguration('http').get('proxyStrictSSL'), strictSSL);
                for (const scenario of ['trusted-both', 'untrusted-proxy', 'untrusted-destination']) {
                    tls.setDefaultCACertificates(scenario === 'untrusted-proxy' ? [] : [proxyCertificate]);
                    https.globalAgent.destroy();
                    const before = JSON.parse(await readFile(process.env.COSMOS_PROXY_TLS_TUNNELS, 'utf8'));
                    const delegate = createCosmosHttpClient(
                        vscode.workspace.getConfiguration('http').get('proxyStrictSSL') !== false,
                    );
                    const client = new CosmosClient({
                        endpoint: `https://account.proxy-test.invalid:${process.env.COSMOS_PROXY_TEST_PORT}`,
                        key: Buffer.from('local-test-key').toString('base64'),
                        httpClient: {
                            sendRequest(request) {
                                request.requestOverrides = {
                                    ca:
                                        scenario === 'untrusted-destination'
                                            ? proxyCertificate
                                            : destinationCertificate,
                                    lookup: (_host, options, callback) => {
                                        if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
                                        else callback(null, '127.0.0.1', 4);
                                    },
                                };
                                return delegate.sendRequest(request);
                            },
                        },
                        connectionPolicy: {
                            enableEndpointDiscovery: false,
                            requestTimeout: 3000,
                            retryOptions: { maxRetryAttemptCount: 0 },
                        },
                    });
                    let outcome = 'SUCCESS';
                    let errorCode;
                    let errorMessage;
                    try {
                        const response = await client.getDatabaseAccount();
                        assert.equal(response.resource?.consistencyPolicy, 'Strong');
                    } catch (error) {
                        outcome = 'REJECTED';
                        errorCode = error.code;
                        errorMessage = error.message;
                    } finally {
                        client.dispose();
                        https.globalAgent.destroy();
                    }
                    const after = JSON.parse(await readFile(process.env.COSMOS_PROXY_TLS_TUNNELS, 'utf8'));
                    const tunnels = after - before;
                    const result = {
                        vscode: vscode.version,
                        type: 'TLS',
                        mode,
                        strictSSL,
                        scenario,
                        outcome,
                        tunnels,
                        errorCode,
                        errorMessage,
                    };
                    results.push(result);
                    console.log(`TLS_RESULT ${JSON.stringify(result)}`);
                    if (scenario === 'trusted-both') {
                        assert.equal(outcome, 'SUCCESS', JSON.stringify(result));
                        assert.equal(tunnels > 0, mode !== 'off', JSON.stringify(result));
                    } else if (scenario === 'untrusted-destination') {
                        assert.equal(outcome, strictSSL ? 'REJECTED' : 'SUCCESS', JSON.stringify(result));
                        assert.equal(
                            errorCode,
                            strictSSL ? 'DEPTH_ZERO_SELF_SIGNED_CERT' : undefined,
                            JSON.stringify(result),
                        );
                        assert.equal(tunnels > 0, mode !== 'off', JSON.stringify(result));
                    } else if (mode === 'off') {
                        assert.equal(outcome, 'SUCCESS', JSON.stringify(result));
                        assert.equal(tunnels, 0);
                    } else {
                        assert.equal(outcome, 'REJECTED', JSON.stringify(result));
                        assert.equal(errorCode, 'REQUEST_SEND_ERROR', JSON.stringify(result));
                        assert.equal(tunnels, 0);
                    }
                }
            }
        }
    } finally {
        tls.setDefaultCACertificates(originalCertificates);
        https.globalAgent.destroy();
    }
    return results;
}
