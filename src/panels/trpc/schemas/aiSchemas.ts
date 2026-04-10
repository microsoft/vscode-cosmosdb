/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { z } from 'zod';

// ─── ModelInfo ──────────────────────────────────────────────────────────────

/**
 * Schema for AI model information displayed in the model picker.
 */
export const ModelInfoSchema = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    vendor: z.string().optional(),
});

export type ModelInfo = z.infer<typeof ModelInfoSchema>;
