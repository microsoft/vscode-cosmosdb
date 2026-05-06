/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from '@vscode/test-cli';
import path from 'path';

export default defineConfig([
    {
        label: 'Integration Tests',
        files: 'out/test/**/*.test.js',
        extensionDevelopmentPath: '.',
        version: 'stable',
        installExtensions: ['ms-azuretools.vscode-azureresourcegroups'],
        env: {
            DEBUGTELEMETRY: 'v',
        },
        mocha: {
            ui: 'tdd',
            timeout: 20000,
            color: true,
            reporter: 'mocha-multi-reporters',
            reporterOptions: {
                reporterEnabled: 'spec, mocha-junit-reporter',
                mochaJunitReporterReporterOptions: {
                    mochaFile: path.resolve(import.meta.dirname, '..', '..', 'test-results.xml'),
                },
            },
        },
    },
]);
