/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Experience } from '../../AzureDBExperiences';

export enum AttachEmulatorMode {
    Preconfigured = 'preconfigured', // using a preconfigured emulator
    CustomConnectionString = 'customConnectionString', // using a custom emulator
    Unknown = 'unknown', // not configured
}

export interface AttachEmulatorWizardContext extends IActionContext {
    parentTreeElementId: string;

    experience?: Experience;
    connectionString?: string;
    port?: number;

    // Currently specific to MongoDB Emulator, allows the user to override the default TLS/SSL configuration (e.g. disable it)
    // It's only relevant for the MongoDB Emulator
    disableMongoEmulatorSecurity?: boolean;

    // The selected mode; defaults to Unknown
    mode?: AttachEmulatorMode;
}
