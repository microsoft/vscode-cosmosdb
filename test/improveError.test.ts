/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { improveError } from '../extension.bundle';

suite('improveError', () => {
    test('no change', () => {
        const msg: string = 'where is c:\\Program Files\\MongoDBServer\\4.0\\bin\\mongo.exe?';
        const improved: unknown = improveError(msg);

        assert.equal(parseError(improved).message, msg);
    });

    test('spawn ENOENT', () => {
        const msg: string = 'spawn c:\\Program Files\\MongoDBServer\\4.0\\bin\\mongo.exe ENOENT';
        const improved: unknown = improveError(msg);

        assert.equal(
            parseError(improved).message,
            'Could not find c:\\Program Files\\MongoDBServer\\4.0\\bin\\mongo.exe',
        );
    });
});
