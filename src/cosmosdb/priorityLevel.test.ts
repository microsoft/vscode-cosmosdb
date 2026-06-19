/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PriorityLevel } from '@azure/cosmos';
import { describe, expect, it } from 'vitest';
import { type AzureResourceMetadata } from './AzureResourceMetadata';
import { resolveEffectivePriorityLevel } from './priorityLevel';

// Minimal stand-in; only the presence/absence of azureMetadata matters here.
const azureMetadata = {} as AzureResourceMetadata;

describe('resolveEffectivePriorityLevel', () => {
    it('returns the explicit choice when provided (Azure-backed)', () => {
        expect(resolveEffectivePriorityLevel({ azureMetadata }, 'High' as PriorityLevel)).toBe('High');
    });

    it('returns the explicit choice when provided (non-Azure)', () => {
        expect(resolveEffectivePriorityLevel({ azureMetadata: undefined }, 'High' as PriorityLevel)).toBe('High');
    });

    it('returns undefined for Azure-backed connections without an explicit choice', () => {
        expect(resolveEffectivePriorityLevel({ azureMetadata })).toBeUndefined();
    });

    it('falls back to "Low" for non-Azure connections without an explicit choice', () => {
        expect(resolveEffectivePriorityLevel({ azureMetadata: undefined })).toBe('Low');
    });
});
