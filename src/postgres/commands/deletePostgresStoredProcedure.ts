/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { showPostgresOperationProhibitedError } from '../deprication';

export async function deletePostgresStoredProcedure(context: IActionContext): Promise<void> {
    context.telemetry.properties.depricated = 'true';
    await showPostgresOperationProhibitedError();

    return;
}
