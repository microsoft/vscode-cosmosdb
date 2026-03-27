/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Monaco CompletionItemProvider for CosmosDB NoSQL query language.
 *
 * Provides context-aware autocompletion:
 * - SQL keywords (SELECT, FROM, WHERE, ORDER BY, etc.)
 * - Built-in functions with signatures (aggregate, string, math, type-checking, etc.)
 * - Schema-driven property suggestions after dot notation (e.g. `c.` → property names)
 * - Lightweight alias tracking from the FROM clause
 *
 * Reference: https://learn.microsoft.com/azure/cosmos-db/nosql/query/
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import {
    extractFromAlias,
    getTypeLabel,
    needsBracketNotation,
    NOSQL_FUNCTIONS,
    NOSQL_KEYWORDS,
    NOSQL_LANGUAGE_ID,
    resolveSchemaProperties,
} from '../../../../cosmosdb/language/nosqlLanguageDefinitions';
import { type JSONSchema } from '../../../../utils/json/JSONSchema';

// ─── Completion Provider ───────────────────────────────────────────────────────

/**
 * Creates a CompletionItemProvider for the CosmosDB NoSQL language.
 *
 * @param getSchema - A function that returns the current container schema (or null).
 *                    This is called on every completion request to get fresh schema data.
 */
export function createNoSqlCompletionProvider(
    monacoInstance: typeof monaco,
    getSchema: () => JSONSchema | null,
): monaco.languages.CompletionItemProvider {
    return {
        triggerCharacters: ['.', ' '],

        provideCompletionItems(
            model: monaco.editor.ITextModel,
            position: monaco.Position,
        ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
            const textUntilPosition = model.getValueInRange({
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
            });

            const lineContent = model.getLineContent(position.lineNumber);
            const textBeforeCursor = lineContent.substring(0, position.column - 1);

            const wordInfo = model.getWordUntilPosition(position);
            const range: monaco.IRange = {
                startLineNumber: position.lineNumber,
                startColumn: wordInfo.startColumn,
                endLineNumber: position.lineNumber,
                endColumn: wordInfo.endColumn,
            };

            const suggestions: monaco.languages.CompletionItem[] = [];

            // ── 1. Dot-triggered property completions ──────────────────────
            const dotMatch = textBeforeCursor.match(/(\w+(?:\.\w+)*)\.(\w*)$/);

            if (dotMatch) {
                const schema = getSchema();
                const fullPath = dotMatch[1]; // e.g. "c.address" or "c"
                const segments = fullPath.split('.');
                const fromAlias = extractFromAlias(textUntilPosition);

                // Check if the root segment matches the FROM alias
                if (segments[0].toLowerCase() === fromAlias.toLowerCase()) {
                    // Remove the alias, keep the property path
                    const propertyPath = segments.slice(1);

                    if (schema) {
                        const properties = resolveSchemaProperties(schema, propertyPath);
                        if (properties) {
                            // Adjust range to cover the partial word after the dot
                            const dotRange: monaco.IRange = {
                                startLineNumber: position.lineNumber,
                                startColumn: position.column - (dotMatch[2]?.length ?? 0),
                                endLineNumber: position.lineNumber,
                                endColumn: position.column,
                            };

                            for (const [name, propSchema] of Object.entries(properties)) {
                                const typeLabel = getTypeLabel(propSchema as JSONSchema);
                                const hasChildren = !!(propSchema as JSONSchema).properties;

                                if (needsBracketNotation(name)) {
                                    // For properties needing bracket notation, replace the dot with ["..."]
                                    suggestions.push({
                                        label: {
                                            label: name,
                                            detail: ` (${typeLabel})`,
                                            description: 'bracket notation',
                                        } as monaco.languages.CompletionItemLabel,
                                        kind: monacoInstance.languages.CompletionItemKind.Field,
                                        insertText: `["${name}"]`,
                                        range: {
                                            // Go back one more to replace the dot
                                            startLineNumber: position.lineNumber,
                                            startColumn: position.column - (dotMatch[2]?.length ?? 0) - 1,
                                            endLineNumber: position.lineNumber,
                                            endColumn: position.column,
                                        },
                                        detail: typeLabel,
                                        sortText: `0_${name}`,
                                    });
                                } else {
                                    suggestions.push({
                                        label: {
                                            label: name,
                                            detail: ` (${typeLabel})`,
                                        } as monaco.languages.CompletionItemLabel,
                                        kind: hasChildren
                                            ? monacoInstance.languages.CompletionItemKind.Module
                                            : monacoInstance.languages.CompletionItemKind.Field,
                                        insertText: name,
                                        range: dotRange,
                                        detail: typeLabel,
                                        sortText: `0_${name}`,
                                    });
                                }
                            }
                        }
                    }
                }

                // If dot-triggered, return only property suggestions (don't mix with keywords)
                return { suggestions };
            }

            // ── 2. Keyword completions ─────────────────────────────────────
            for (const keyword of NOSQL_KEYWORDS) {
                suggestions.push({
                    label: keyword,
                    kind: monacoInstance.languages.CompletionItemKind.Keyword,
                    insertText: keyword,
                    range,
                    sortText: `1_${keyword}`,
                });
            }

            // ── 3. Function completions ────────────────────────────────────
            for (const func of NOSQL_FUNCTIONS) {
                suggestions.push({
                    label: {
                        label: func.name,
                        detail: `  ${func.signature}`,
                    } as monaco.languages.CompletionItemLabel,
                    kind: monacoInstance.languages.CompletionItemKind.Function,
                    insertText: `${func.name}($0)`,
                    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    detail: func.signature,
                    documentation: func.description,
                    sortText: `2_${func.name}`,
                });
            }

            // ── 4. Alias suggestion (the FROM alias for quick access) ──────
            const fromAlias = extractFromAlias(textUntilPosition);
            suggestions.push({
                label: {
                    label: fromAlias,
                    description: 'collection alias',
                } as monaco.languages.CompletionItemLabel,
                kind: monacoInstance.languages.CompletionItemKind.Variable,
                insertText: fromAlias,
                range,
                detail: 'Collection alias from FROM clause',
                sortText: `0_${fromAlias}`,
            });

            return { suggestions };
        },
    };
}

/**
 * Registers the NoSQL completion provider with Monaco.
 * Returns a disposable that should be cleaned up when no longer needed.
 */
export function registerNoSqlCompletionProvider(
    monacoInstance: typeof monaco,
    getSchema: () => JSONSchema | null,
): monaco.IDisposable {
    const provider = createNoSqlCompletionProvider(monacoInstance, getSchema);
    return monacoInstance.languages.registerCompletionItemProvider(NOSQL_LANGUAGE_ID, provider);
}
