/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDbOperation } from './CosmosDbOperationsService';

export interface ParsedOperation {
    operation: string;
    parameters: Record<string, unknown>;
    confidence: number;
}

export class OperationParser {
    /**
     * Parse user input to detect operation intent
     */
    public static parseUserInput(input: string, _availableOperations: CosmosDbOperation[]): ParsedOperation | null {
        const lowerInput = input.toLowerCase().trim();

        // Query execution
        const queryMatch = this.extractQuery(lowerInput);
        if (queryMatch) {
            return {
                operation: 'executeQuery',
                parameters: {
                    query: queryMatch.query,
                    includeMetrics: queryMatch.includeMetrics,
                },
                confidence: 0.8,
            };
        }

        // Query editor
        if (this.matchesPatterns(lowerInput, ['open query editor', 'create query', 'new query'])) {
            return { operation: 'openQueryEditor', parameters: {}, confidence: 0.7 };
        }

        // List databases
        if (this.matchesPatterns(lowerInput, ['list databases', 'show databases', 'available databases'])) {
            return { operation: 'listDatabases', parameters: {}, confidence: 0.8 };
        }

        return null;
    }

    private static matchesPatterns(input: string, patterns: string[]): boolean {
        return patterns.some((pattern) => input.includes(pattern));
    }

    private static extractQuery(input: string): { query: string; includeMetrics: boolean } | null {
        // Look for SQL-like queries
        const sqlPattern = /(?:execute|run|query)?\s*(?:query)?\s*[:.-]?\s*(select\s+.*(?:from|where|order|group).*)/i;
        const match = input.match(sqlPattern);

        if (match && match[1]) {
            const includeMetrics = input.includes('metrics') || input.includes('performance');
            return { query: match[1].trim(), includeMetrics };
        }

        // Look for direct SELECT statements
        if (input.startsWith('select ') && (input.includes('from') || input.includes('where'))) {
            const includeMetrics = input.includes('metrics') || input.includes('performance');
            return { query: input, includeMetrics };
        }

        return null;
    }

    /**
     * Generate operation suggestions based on current context
     */
    public static generateSuggestions(hasConnection: boolean): string {
        if (!hasConnection) {
            return `\n\n💡 **Quick Operations:**
- Say "open query editor" to create a new query`;
        }

        return `\n\n💡 **Quick Operations:**
- Say "execute: SELECT * FROM c" to run a query
- Say "open query editor" to create a new query tab`;
    }
}
