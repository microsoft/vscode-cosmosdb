/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtServiceClientCredentials } from "@microsoft/vscode-azext-utils";

/**
 * Gets a function that can request an access token for a specified scope for the signed-in azure account.
 */
export function getTokenFunction(credentials: AzExtServiceClientCredentials, scope: string): () => Promise<string> {
    return async () => {
        const getTokenResult = await credentials.getToken(scope) as { token: string } | undefined;
        return getTokenResult?.token ?? "";
    };
}
