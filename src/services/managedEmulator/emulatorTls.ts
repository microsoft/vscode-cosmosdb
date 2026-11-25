/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Agent } from 'https';
import { EmulatorError, loopback } from './model';

export function createManagedEmulatorAgent(endpoint: string, ca: string | undefined): Agent {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.hostname !== loopback || !ca) throw new EmulatorError('certificate');
    return new Agent({ ca, rejectUnauthorized: true });
}
