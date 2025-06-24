/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type HotkeyScope = 'global' | (string & {});
export type HotkeyCommand = string;

export interface HotkeyMapping<Command extends HotkeyCommand> {
    key: string;
    command: Command;
    description?: string;
    shortcutDisplay: {
        windows: string;
        mac: string;
    };
}
