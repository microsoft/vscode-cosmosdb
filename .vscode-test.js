const { defineConfig } = require('@vscode/test-cli');
const path = require('path');

module.exports = defineConfig([
    {
        label: 'Integration Tests',
        files: 'out/test/**/*.test.js',
        extensionDevelopmentPath: '.',
        installExtensions: ['ms-vscode.azure-account', 'ms-azuretools.vscode-azureresourcegroups'],
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
                    mochaFile: path.resolve(__dirname, '..', '..', 'test-results.xml'),
                },
            },
        },
    },
]);
