/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Experience } from '../../AzureDBExperiences';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';

export enum NewEmulatorConnectionMode {
    Preconfigured = 'preconfigured', // using a preconfigured emulator
    CustomConnectionString = 'customConnectionString', // using a custom emulator
    Unknown = 'unknown', // not configured
}

export interface NewEmulatorConnectionWizardContext extends IActionContext {
    parentTreeElementId: string;

    experience?: Experience;
    connectionString?: string;
    port?: number;

    mongoEmulatorConfiguration?: EmulatorConfiguration;
    // TODO: refactor to CoreEmulatorConfiguration as it's done for MongoEmulatorConfiguration in case more core-emulator properties are added
    isCoreEmulator?: boolean;

    // The selected mode; defaults to Unknown
    mode?: NewEmulatorConnectionMode;
}
