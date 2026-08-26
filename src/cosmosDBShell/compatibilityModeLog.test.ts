/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { createCompatibilityModeLogger } from './compatibilityModeLog';

describe('createCompatibilityModeLogger', () => {
    it('logs the installed version only once per logger instance', () => {
        const log = vi.fn();
        const logCompatibilityMode = createCompatibilityModeLogger(log);

        logCompatibilityMode('1.1.150-preview');
        logCompatibilityMode('1.1.150-preview');

        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            'Cosmos DB Shell 1.1.150-preview does not support startup location arguments. Using escaped compatibility navigation.',
        );
    });

    it('explains compatibility mode when the installed version cannot be determined', () => {
        const log = vi.fn();
        const logCompatibilityMode = createCompatibilityModeLogger(log);

        logCompatibilityMode(undefined);

        expect(log).toHaveBeenCalledWith(
            'The Cosmos DB Shell version could not be determined. Using escaped compatibility navigation.',
        );
    });
});
