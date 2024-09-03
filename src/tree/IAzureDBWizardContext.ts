/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type IResourceGroupWizardContext } from '@microsoft/vscode-azext-azureutils';
import  { type Experience } from '../AzureDBExperiences';

export interface IAzureDBWizardContext extends IResourceGroupWizardContext {
    newServerName?: string;
    defaultExperience?: Experience;
}
