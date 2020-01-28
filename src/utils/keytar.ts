/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tslint:disable-next-line: no-implicit-dependencies
import * as keytarType from 'keytar';
import { getCoreNodeModule } from "./getCoreNodeModule";

export type KeyTar = typeof keytarType;

export function tryGetKeyTar(): KeyTar | undefined {
    return getCoreNodeModule('keytar');
}
