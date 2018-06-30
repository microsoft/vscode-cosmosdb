/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import vscode = require('vscode');
import TelemetryReporter from 'vscode-extension-telemetry';
import { ext } from '../extensionVariables';

export class Reporter extends vscode.Disposable {

    constructor(ctx: vscode.ExtensionContext) {

        super(() => ext.reporter.dispose());

        let packageInfo = getPackageInfo(ctx);
        ext.reporter = packageInfo && new TelemetryReporter(packageInfo.name, packageInfo.version, packageInfo.aiKey);
    }
}

interface IPackageInfo {
    name: string;
    version: string;
    aiKey: string;
}

function getPackageInfo(context: vscode.ExtensionContext): IPackageInfo | undefined {
    // tslint:disable-next-line:non-literal-require
    let extensionPackage = require(context.asAbsolutePath('./package.json'));
    if (extensionPackage) {
        return {
            name: extensionPackage.name,
            version: extensionPackage.version,
            aiKey: extensionPackage.aiKey
        };
    }
    return undefined;
}
