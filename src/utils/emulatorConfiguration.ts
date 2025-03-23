/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface EmulatorConfiguration {
    /**
     * Indicates if the connection is to an emulator.
     */
    isEmulator: boolean;

    /**
     * Indicates if the emulator security should be disabled.
     */
    disableEmulatorSecurity: boolean;
}

/**
 * Returns the default MongoEmulatorConfiguration with isEmulator set to true
 * and disableEmulatorSecurity set to false.
 */
export const defaultMongoEmulatorConfiguration: EmulatorConfiguration = {
    isEmulator: true,
    disableEmulatorSecurity: false,
};
