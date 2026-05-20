/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import assert from 'node:assert';
import * as path from 'path';
import { ThemeIcon, Uri, type IconPath } from 'vscode';
import { ext } from './extensionVariables';

export const isWindows: boolean = process.platform.startsWith('win');
export const isLinux: boolean = process.platform.startsWith('linux');
export const isMacOS: boolean = process.platform.startsWith('darwin');

export namespace Links {
    export const LocalConnectionDebuggingTips: string = 'https://aka.ms/AA5zah5';
}

export function getThemedIconPath(iconName: string): IconPath {
    const light = path.join(getResourcesPath(), 'icons', 'light', iconName);
    const dark = path.join(getResourcesPath(), 'icons', 'dark', iconName);

    assert.ok(fs.existsSync(light));
    assert.ok(fs.existsSync(dark));

    return {
        light: Uri.file(light),
        dark: Uri.file(dark),
    };
}

export function getThemeAgnosticIconPath(iconName: string): IconPath {
    const icon = path.join(getResourcesPath(), 'icons', 'theme-agnostic', iconName);

    assert.ok(fs.existsSync(icon));

    return Uri.file(icon);
}

export function getThemeAgnosticIconURI(iconName: string): IconPath {
    const iconPath = Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'theme-agnostic', iconName);
    if (!fs.existsSync(iconPath.fsPath)) {
        ext.outputChannel.warn(`Icon not found: ${iconPath.fsPath}`);
        return new ThemeIcon('database');
    }

    return {
        light: iconPath,
        dark: iconPath,
    };
}

export function getResourcesPath(): string {
    return ext.context.asAbsolutePath('resources');
}

export const doubleClickDebounceDelay = 500; //milliseconds

export const defaultStoredProcedure = `function sample(prefix) {
    var collection = getContext().getCollection();

    // Query documents and take 1st item.
    var isAccepted = collection.queryDocuments(
        collection.getSelfLink(),
        'SELECT * FROM root r',
        function (err, feed, options) {
            if (err) throw err;

            // Check the feed and if empty, set the body to 'no docs found',
            // else take 1st element from feed
            if (!feed || !feed.length) {
                var response = getContext().getResponse();
                response.setBody('no docs found');
            }

            else {
                var response = getContext().getResponse();
                var body = { prefix: prefix, feed: feed[0] };
                response.setBody(JSON.stringify(body));
            }
        });

    if (!isAccepted) throw new Error('The query was not accepted by the server.');
};`;

export const defaultTrigger = `function trigger() {

}`;

// Determine if emulator is supported on this platform, historically this was needed to disable emulator support on Silicon Macs
// which is now supported via Docker. We still keep the check in case there are any other platform specific issues in the future.
export const isEmulatorSupported = isWindows || isLinux || isMacOS;

const FabricArtifactType = ['CosmosDBDatabase', 'MirroredDatabase' /*MountedRelationalDatabase*/] as const;
export type FabricArtifactType = (typeof FabricArtifactType)[number];

export class CosmosDBTimeouts {
    /**
     * Connection timeout for emulators (shorter since they should respond quickly if running)
     */
    public static readonly EMULATOR_CONNECTION_TIMEOUT_MS = 1000;

    /**
     * Connection timeout for remote accounts (longer to account for network latency)
     */
    public static readonly CONNECTION_TIMEOUT_MS = 5000;
}
