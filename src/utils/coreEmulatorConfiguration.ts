/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CoreEmulatorConfiguration {
    /**
     * Indicates if the connection is to an emulator.
     */
    isEmulator: boolean;
}

/**
 * Returns the default CoreEmulatorConfiguration with isEmulator set to true
 */
export const defaultCoreEmulatorConfiguration: CoreEmulatorConfiguration = {
    isEmulator: true,
};
