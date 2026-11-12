/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolve } from 'node:path';
import { prepareFixture } from './fixtures.mjs';

await prepareFixture(resolve('app'), process.argv[2], resolve('cosmosdb-migration'));
