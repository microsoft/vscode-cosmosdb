/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type GenericResource } from '@azure/arm-resources';
import { type AzureResource } from '@microsoft/vscode-azureresources-api';

export type CosmosDBResource = AzureResource &
    GenericResource & {
        readonly raw: GenericResource; // Resource object from Azure SDK
    };

export type CosmosAccountModel = CosmosDBResource;
