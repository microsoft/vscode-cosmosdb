/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const isWindows: boolean = /^win/.test(process.platform);
export const isLinux: boolean = /^linux/.test(process.platform);
export const isMacOS: boolean = /^darwin/.test(process.platform);

import * as fs from 'fs';
import assert from 'node:assert';
import * as path from 'path';
import { Uri, type IconPath } from 'vscode';
import { ext } from './extensionVariables';

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

export const wellKnownEmulatorPassword =
    'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';

export const isEmulatorSupported = isWindows || isLinux || (isMacOS && process.arch === 'x64');

export const SERVERLESS_CAPABILITY_NAME = 'EnableServerless';

export const CosmosDBHiddenFields: string[] = ['_rid', '_self', '_etag', '_attachments', '_ts'];
