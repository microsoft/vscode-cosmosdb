/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    azureResourceExperience,
    type ITreeItemPickerContext,
    type TreeElementWithId,
} from '@microsoft/vscode-azext-utils';
import { type AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { ext } from '../../extensionVariables';

export interface PickAppResourceOptions {
    type?: AzExtResourceType | AzExtResourceType[];
    expectedChildContextValue?: string | RegExp | (string | RegExp)[];
}

export async function pickAppResource<T extends TreeElementWithId>(
    context: ITreeItemPickerContext,
    options?: PickAppResourceOptions,
): Promise<T> {
    return azureResourceExperience(
        context,
        ext.rgApiV2.resources.azureResourceTreeDataProvider,
        options?.type ? (Array.isArray(options.type) ? options.type : [options.type]) : undefined,
        options?.expectedChildContextValue ? { include: options.expectedChildContextValue } : undefined,
    );
}
