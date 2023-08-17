/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtServiceClientCredentials } from "@microsoft/vscode-azext-utils";
import { getApiExport } from "./getExtensionApi";

const azureAccountExtensionId = "ms-vscode.azure-account";

/**
 * @returns The userId of the signed-in azure account.
 */
export async function getAzureAdUserId(): Promise<string | undefined> {
    const azureAccountExport: any = await getApiExport(azureAccountExtensionId);
    const session = azureAccountExport.sessions?.[0];
    return session?.userId;
}

/**
 * Gets a token credential for a specified scope for the signed-in azure account.
 */
export function getTokenCredential(credentials: AzExtServiceClientCredentials, scope: string): () => Promise<string> {
    return async () => {
        const getTokenResult = await credentials.getToken(scope);
        return getTokenResult?.token ?? "";
    };
}
