/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';

const certificateTrustErrorCodes = new Set([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

export function getTreeErrorMessage(error: unknown): string {
    const seen = new Set<object>();
    let current = error;

    while (typeof current === 'object' && current !== null && !seen.has(current)) {
        seen.add(current);
        if ('code' in current && typeof current.code === 'string' && certificateTrustErrorCodes.has(current.code)) {
            return l10n.t(
                'TLS certificate verification failed ({0}). If this is a Cosmos DB emulator, remove the attached connection and use "New Emulator Connection" under "Local Emulators". For other connections, ensure the server certificate chain is trusted by the VS Code extension host. Do not disable certificate validation globally.',
                current.code,
            );
        }
        current = 'cause' in current ? current.cause : undefined;
    }

    return parseError(error).message;
}
