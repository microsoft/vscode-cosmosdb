/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as http from 'node:http';
import * as https from 'node:https';
import { builtinModules } from 'node:module';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'cp-'));
const servers = [];
const tunnelSockets = new Set();

try {
    const keyPath = path.join(temporary, 'key.pem');
    const certPath = path.join(temporary, 'cert.pem');
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '1',
            '-keyout',
            keyPath,
            '-out',
            certPath,
            '-subj',
            '/CN=account.proxy-test.invalid',
            '-addext',
            'subjectAltName=DNS:account.proxy-test.invalid,DNS:localhost,IP:127.0.0.1',
        ],
        { stdio: 'ignore' },
    );

    const origin = https.createServer(
        {
            key: await readFile(keyPath),
            cert: await readFile(certPath),
        },
        (_request, response) => {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ userConsistencyPolicy: { defaultConsistencyLevel: 'Strong' } }));
        },
    );
    const proxy = http.createServer((_request, response) => {
        response.writeHead(407, { 'content-type': 'application/json' });
        response.end('{}');
    });
    proxy.on('connect', (_request, socket) => {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 2\r\n\r\n{}');
    });
    for (const server of [origin, proxy]) {
        servers.push(server);
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
    }

    const proxyKeyPath = path.join(temporary, 'proxy-key.pem');
    const proxyCertPath = path.join(temporary, 'proxy-cert.pem');
    execFileSync(
        'openssl',
        [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '1',
            '-keyout',
            proxyKeyPath,
            '-out',
            proxyCertPath,
            '-subj',
            '/CN=localhost',
            '-addext',
            'subjectAltName=DNS:localhost,IP:127.0.0.1',
        ],
        { stdio: 'ignore' },
    );
    const tunnelCountPath = path.join(temporary, 'tunnels.json');
    let tunnelCount = 0;
    await writeFile(tunnelCountPath, '0');
    const secureProxy = https.createServer(
        { key: await readFile(proxyKeyPath), cert: await readFile(proxyCertPath) },
        (_request, response) => {
            response.writeHead(403);
            response.end();
        },
    );
    secureProxy.on('connect', (request, socket, head) => {
        if (request.url !== `account.proxy-test.invalid:${origin.address().port}`) {
            socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
            return;
        }
        const upstream = net.connect(origin.address().port, '127.0.0.1', () => {
            void writeFile(tunnelCountPath, JSON.stringify(++tunnelCount)).then(
                () => {
                    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                    if (head.length) upstream.write(head);
                    socket.pipe(upstream);
                    upstream.pipe(socket);
                },
                (error) => {
                    console.error('Unable to record proxy tunnel:', error);
                    socket.destroy();
                    upstream.destroy();
                },
            );
        });
        for (const stream of [socket, upstream]) {
            tunnelSockets.add(stream);
            stream.on('close', () => tunnelSockets.delete(stream));
        }
        socket.on('close', () => upstream.destroy());
        upstream.on('close', () => socket.destroy());
        socket.on('error', (error) => {
            console.error('Proxy tunnel client error:', error.message);
            upstream.destroy();
        });
        upstream.on('error', (error) => {
            console.error('Proxy tunnel upstream error:', error.message);
            socket.destroy();
        });
    });
    servers.push(secureProxy);
    secureProxy.listen(0, '127.0.0.1');
    await once(secureProxy, 'listening');

    const fixture = path.join(temporary, 'extension');
    await mkdir(fixture);
    await writeFile(
        path.join(fixture, 'package.json'),
        JSON.stringify({
            name: 'cosmos-proxy-test',
            publisher: 'local-tests',
            version: '0.0.1',
            engines: { vscode: '^1.109.0' },
            type: 'module',
            main: './host.mjs',
            activationEvents: ['*'],
        }),
    );
    await build({
        configFile: false,
        root,
        logLevel: 'warn',
        resolve: {
            conditions: ['import', 'require', 'node'],
            mainFields: ['module', 'main'],
        },
        build: {
            outDir: fixture,
            emptyOutDir: false,
            target: 'node22',
            minify: false,
            lib: {
                entry: path.join(root, 'scripts/test-proxy-host.mjs'),
                formats: ['es'],
                fileName: () => 'host.mjs',
            },
            rollupOptions: {
                external: (id) => id === 'vscode' || id.startsWith('node:') || builtinModules.includes(id),
                output: {
                    banner: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
                },
            },
        },
    });

    const executable = process.argv[2] || (await downloadAndUnzipVSCode('stable'));
    const results = [];
    for (const noProxy of ['', 'account.proxy-test.invalid']) {
        const profile = path.join(temporary, noProxy ? 'p1' : 'p0');
        await mkdir(path.join(profile, 'User'), { recursive: true });
        await writeFile(
            path.join(profile, 'User/settings.json'),
            JSON.stringify({
                'telemetry.telemetryLevel': 'off',
                'update.mode': 'none',
                'extensions.autoCheckUpdates': false,
                'extensions.autoUpdate': false,
                'http.proxySupport': 'off',
                'http.systemCertificates': false,
                'chat.disableAIFeatures': true,
            }),
        );
        const resultFile = path.join(profile, 'results.json');
        const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
        const exitCode = await runTests({
            vscodeExecutablePath: executable,
            extensionDevelopmentPath: fixture,
            extensionTestsPath: path.join(fixture, 'host.mjs'),
            extensionTestsEnv: {
                HTTP_PROXY: proxyUrl,
                HTTPS_PROXY: proxyUrl,
                http_proxy: proxyUrl,
                https_proxy: proxyUrl,
                NO_PROXY: noProxy,
                no_proxy: noProxy,
                ALL_PROXY: '',
                all_proxy: '',
                COSMOS_PROXY_TEST_PORT: String(origin.address().port),
                COSMOS_PROXY_TEST_CERT: certPath,
                COSMOS_PROXY_TEST_RESULTS: resultFile,
                COSMOS_PROXY_TLS_URL: `https://127.0.0.1:${secureProxy.address().port}`,
                COSMOS_PROXY_TLS_CERT: proxyCertPath,
                COSMOS_PROXY_TLS_TUNNELS: tunnelCountPath,
            },
            launchArgs: [
                '--user-data-dir',
                profile,
                '--extensions-dir',
                path.join(temporary, 'extensions'),
                '--disable-extensions',
                '--disable-workspace-trust',
                '--skip-welcome',
                '--skip-release-notes',
            ],
        });
        if (exitCode !== 0) {
            throw new Error(`Proxy test host exited with code ${exitCode}`);
        }
        results.push(...JSON.parse(await readFile(resultFile, 'utf8')));
    }
    console.table(results.filter((result) => result.type !== 'TLS'));
    console.table(
        results
            .filter((result) => result.type === 'TLS')
            .map(({ vscode, mode, strictSSL, scenario, outcome, tunnels }) => ({
                vscode,
                mode,
                strictSSL,
                scenario,
                outcome,
                tunnels,
            })),
    );
} finally {
    for (const socket of tunnelSockets) socket.destroy();
    for (const server of servers) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
    await rm(temporary, { recursive: true, force: true });
}
