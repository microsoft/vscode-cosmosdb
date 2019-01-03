/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as glob from 'glob';
import * as gulp from 'gulp';
import * as decompress from 'gulp-decompress';
import * as download from 'gulp-download';
import * as os from 'os';
import * as path from 'path';

/**
 * Installs the azure account extension before running tests (otherwise our extension would fail to activate)
 * NOTE: The version isn't super important since we don't actually use the account extension in tests
 */
function installAzureAccount() {
    const version = '0.4.3';
    const extensionPath = path.join(os.homedir(), `.vscode/extensions/ms-vscode.azure-account-${version}`);
    const existingExtensions = glob.sync(extensionPath.replace(version, '*'));
    if (existingExtensions.length === 0) {
        return download(`http://ms-vscode.gallery.vsassets.io/_apis/public/gallery/publisher/ms-vscode/extension/azure-account/${version}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`)
            .pipe(decompress({
                filter: file => file.path.startsWith('extension/'),
                map: file => {
                    file.path = file.path.slice(10);
                    return file;
                }
            }))
            .pipe(gulp.dest(extensionPath));
    } else {
        console.log("Azure Account extension already installed.")
        // We need to signal to gulp that we've completed this async task
        return Promise.resolve();
    }
}

function test() {
    const env = process.env;
    env.DEBUGTELEMETRY = '1';
    env.MOCHA_reporter = 'mocha-junit-reporter';
    env.MOCHA_FILE = path.join(__dirname, 'test-results.xml');
    return cp.spawn('node', ['./node_modules/vscode/bin/test'], { stdio: 'inherit', env });
}

exports.test = gulp.series(installAzureAccount, test);
