/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';

export const accountActionInput = z.discriminatedUnion('action', [
    z.object({ action: z.literal('createDatabase') }),
    z.object({
        action: z.literal('createContainer'),
        databaseId: z
            .string()
            .min(1)
            .regex(/^[^/\\?#]+$/)
            .optional(),
    }),
    z.object({ action: z.literal('deleteAccount') }),
    z.object({ action: z.literal('openCosts') }),
    z.object({ action: z.literal('openJson') }),
]);

export type AccountActionInput = z.infer<typeof accountActionInput>;

export interface AccountActionResult {
    status: 'completed' | 'cancelled';
}
