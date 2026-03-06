/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * One-shot examples for Cosmos DB NoSQL query generation.
 *
 * These examples are injected as User/Assistant message pairs into the LLM
 * prompt to improve query generation accuracy through few-shot learning.
 *
 * Per VS Code LanguageModelChatMessage API:
 * - User messages use LanguageModelChatMessage.User()
 * - Assistant messages use LanguageModelChatMessage.Assistant()
 *
 * Token estimates (approximate, ~4 chars/token):
 * - Unique examples (not covered by instructions): ~520 tokens
 * - Redundant examples (covered by instructions):  ~480 tokens
 * - Total all examples:                            ~1,000 tokens
 */

import type * as vscode from 'vscode';

/**
 * A single one-shot example: a user question and the expected assistant response.
 */
export interface QueryOneShotExample {
    /** The natural language question (sent as User role) */
    question: string;
    /** The expected Cosmos DB NoSQL query response (sent as Assistant role) */
    query: string;
}

/**
 * One-shot examples that demonstrate query patterns NOT already covered
 * by the NoSQL query language reference (azurecosmosdb-nosql-query-language.md).
 *
 * These provide unique value by showing complex/combined patterns.
 */
const UNIQUE_EXAMPLES: QueryOneShotExample[] = [
    // Pattern: _ts comparison with DateTimeToTimestamp division by 1000
    {
        question: 'Find all records created in the last 1024 days',
        query: "SELECT * FROM c WHERE c._ts >= DateTimeToTimestamp(DateTimeAdd('day', -1024, GetCurrentDateTime()))/1000",
    },
    // Pattern: Scalar subquery with MIN on an array property
    {
        question: "What is the minimum price in the price history of item 'dfa2375b-95b7-43a5-9d59-5f5ffcdb1447'?",
        query: "SELECT (SELECT VALUE MIN(price) FROM price IN c.priceHistory) AS minPrice FROM c WHERE c.id = 'dfa2375b-95b7-43a5-9d59-5f5ffcdb1447'",
    },
    // Pattern: ARRAY() expression projecting nested values from an array
    {
        question: 'Show me all product names and an array of customer names who have reviewed each product.',
        query: 'SELECT c.name, ARRAY(SELECT VALUE f.username FROM f IN c.customerRatings) AS usernames FROM c',
    },
    // Pattern: JOIN + GROUP BY + COUNT for aggregation
    {
        question: 'Give me each keyword in the dataset and how many times they occurred.',
        query: 'SELECT k.name AS keyword, COUNT(k) AS occurrence FROM c JOIN k IN c.keywords GROUP BY k.name',
    },
    // Pattern: COUNT on subquery with DISTINCT (count of unique values)
    {
        question: 'How many distinct movie titles exist?',
        query: 'SELECT COUNT(1) AS count FROM (SELECT DISTINCT c.title FROM c)',
    },
    // Pattern: EXISTS + STRINGEQUALS on nested array property with COUNT
    {
        question: 'How many movies did the production company Eon Productions make?',
        query: "SELECT COUNT(c) AS movieCount FROM c WHERE EXISTS (SELECT VALUE t FROM t IN c.production_companies WHERE STRINGEQUALS(t.name, 'Eon Productions', true))",
    },
];

/**
 * One-shot examples that ARE already covered by the NoSQL query language reference
 * (azurecosmosdb-nosql-query-language.md). These patterns are documented in the
 * instructions with syntax, rules, and inline examples.
 *
 * Kept for now as reinforcement; consider removing if token budget is tight.
 * Removing these would save ~480 tokens.
 */
const REDUNDANT_EXAMPLES: QueryOneShotExample[] = [
    // Covered by: String Functions > STRINGEQUALS + Aggregate Functions > COUNT
    {
        question: 'What is the total number of cooking items?',
        query: "SELECT COUNT(c) AS itemCount FROM c WHERE STRINGEQUALS(c.category, 'cooking', true)",
    },
    // Covered by: Date and Time Functions > DateTimePart
    {
        question: "What day was product 'x' first available?",
        query: "SELECT DateTimePart('day', c.firstAvailable) AS day FROM c WHERE c.id = 'x'",
    },
    // Covered by: String Functions > CONTAINS with ignoreCase
    {
        question: "Which products have a description containing the word 'math'?",
        query: "SELECT * FROM c WHERE CONTAINS(c.category, 'math', true)",
    },
    // Covered by: EXISTS Expression section
    {
        question: 'Show all products that have been reviewed by at least one verified user.',
        query: 'SELECT * FROM c WHERE EXISTS(SELECT VALUE r FROM r IN c.customerRatings WHERE r.verifiedUser = true)',
    },
    // Covered by: Keywords > IN (NOT IN follows logically)
    {
        question: 'Find items produced outside of the Americas.',
        query: "SELECT * FROM c WHERE c.countryOfOrigin NOT IN ('USA', 'Canada', 'Mexico')",
    },
    // Covered by: OFFSET LIMIT + ORDER BY sections
    {
        question: 'Give me the top 10 records with the highest ratings, skipping the first 5.',
        query: 'SELECT * FROM c ORDER BY c.rating DESC OFFSET 5 LIMIT 10',
    },
    // Covered by: Keywords > BETWEEN section
    {
        question: 'Which movies had a vote average between 5 and 7?',
        query: 'SELECT * FROM c WHERE c.vote_average BETWEEN 5 AND 7',
    },
    // Covered by: Type Checking Functions > IS_DEFINED
    {
        question: 'Select the runtime of items that have the property original_title.',
        query: 'SELECT c.runtime FROM c WHERE IS_DEFINED(c.original_title)',
    },
];

/**
 * Builds one-shot example messages for query generation prompts.
 *
 * Each example becomes a User/Assistant message pair injected between the
 * system instruction and the actual user request. This follows the VS Code
 * LanguageModelChatMessage API where:
 * - LanguageModelChatMessage.User() represents user turns
 * - LanguageModelChatMessage.Assistant() represents model turns
 *
 * @param includeRedundant Whether to include examples already covered by the
 *   query language reference. Set to false to save ~480 tokens. Default: true.
 * @returns Array of LanguageModelChatMessage pairs (User question, Assistant query)
 */
export function buildQueryOneShotMessages(
    LanguageModelChatMessage: typeof vscode.LanguageModelChatMessage,
    includeRedundant: boolean = true,
): vscode.LanguageModelChatMessage[] {
    const examples = includeRedundant ? [...UNIQUE_EXAMPLES, ...REDUNDANT_EXAMPLES] : UNIQUE_EXAMPLES;

    const messages: vscode.LanguageModelChatMessage[] = [];
    for (const example of examples) {
        messages.push(LanguageModelChatMessage.User(example.question));
        messages.push(LanguageModelChatMessage.Assistant(example.query));
    }
    return messages;
}

/**
 * Returns all one-shot examples (for testing or inspection).
 */
export function getAllOneShotExamples(): {
    unique: QueryOneShotExample[];
    redundant: QueryOneShotExample[];
} {
    return {
        unique: [...UNIQUE_EXAMPLES],
        redundant: [...REDUNDANT_EXAMPLES],
    };
}
