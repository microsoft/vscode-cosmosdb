/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { OperationParser } from './OperationParser';

describe('OperationParser', () => {
    describe('generateSuggestions', () => {
        it('should return tip to open a query editor when there is no connection', () => {
            const result = OperationParser.generateSuggestions(false);

            expect(result).toContain('Open a query editor');
        });

        it('should return command suggestions when there is a connection', () => {
            const result = OperationParser.generateSuggestions(true);

            expect(result).toContain('/editQuery');
            expect(result).toContain('/explainQuery');
            expect(result).toContain('/generateQuery');
        });

        it('should start with two newlines', () => {
            expect(OperationParser.generateSuggestions(false)).toMatch(/^\n\n/);
            expect(OperationParser.generateSuggestions(true)).toMatch(/^\n\n/);
        });
    });
});
