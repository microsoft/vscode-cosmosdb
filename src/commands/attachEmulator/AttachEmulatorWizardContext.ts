/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type Experience } from '../../AzureDBExperiences';

export interface AttachEmulatorWizardContext extends IActionContext {
    parentTreeElementId: string;

    experience?: Experience;
    connectionString?: string;
    port?: number;
}
