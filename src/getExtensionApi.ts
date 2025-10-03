/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type apiUtils } from '@microsoft/vscode-azext-utils';
import { type AzureHostExtensionApi } from '@microsoft/vscode-azext-utils/hostapi';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

export async function getApiExport<T>(extensionId: string): Promise<T | undefined> {
    const extension: vscode.Extension<T> | undefined = vscode.extensions.getExtension(extensionId);
    if (extension) {
        if (!extension.isActive) {
            await extension.activate();
        }

        return extension.exports;
    }

    return undefined;
}

export async function getResourceGroupsApi(): Promise<AzureHostExtensionApi> {
    const rgApiProvider = await getApiExport<apiUtils.AzureExtensionApiProvider>(
        'ms-azuretools.vscode-azureresourcegroups',
    );
    if (rgApiProvider) {
        return rgApiProvider.getApi<AzureHostExtensionApi>('^0.0.1');
    } else {
        throw new Error(l10n.t('Could not find the Azure Resource Groups extension'));
    }
}
