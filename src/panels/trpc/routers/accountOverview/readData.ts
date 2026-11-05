/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../../../extensionVariables';
import { type ReadSource } from '../../../accountOverview/accessRequirements';
import { getResourceMaskedValues } from '../../../accountOverview/resourceMasking';
import { withReadDiagnostics } from '../../../accountOverview/services/readDiagnostics';
import { type UnavailableReason } from '../../../accountOverview/services/shared';

interface ReadMetadata {
    accountId: string;
    accountName: string;
    resourceGroup: string;
}

export function readAccountData<T extends object>(
    metadata: ReadMetadata,
    source: ReadSource,
    work: () => Promise<T>,
    fallback?: (reason: UnavailableReason) => T,
    sensitiveValues: readonly unknown[] = [],
) {
    return withReadDiagnostics(
        source,
        getResourceMaskedValues([metadata.accountId, metadata.accountName, metadata.resourceGroup, ...sensitiveValues]),
        (message) => ext.outputChannel.warn(message),
        work,
        fallback,
    );
}
