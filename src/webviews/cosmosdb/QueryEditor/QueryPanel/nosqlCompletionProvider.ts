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
 * - JOIN alias tracking (e.g. `JOIN s IN p.sizes` → `s.` shows array item properties)
 * - Context-aware string literal suggestions after LIKE keyword
 *
 * Reference: https://learn.microsoft.com/azure/cosmos-db/nosql/query/
 */

// eslint-disable-next-line import/no-internal-modules
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import {
    NOSQL_FUNCTIONS,
    NOSQL_KEYWORDS,
    NOSQL_LANGUAGE_ID,
    type KeywordCategory,
} from '../../../../cosmosdb/language/nosqlLanguageDefinitions';
import {
    extractFromAlias,
    extractJoinAliases,
    getOccurrence,
    getTypeLabel,
    needsBracketNotation,
    resolveJoinAliasSchema,
    resolveSchemaProperties,
    type JoinAlias,
} from '../../../../cosmosdb/language/nosqlParser';
import { type JSONSchema } from '../../../../utils/json/JSONSchema';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps a keyword category to the appropriate Monaco CompletionItemKind.
 */
function categoryToCompletionKind(
    category: KeywordCategory,
    kinds: typeof monaco.languages.CompletionItemKind,
): monaco.languages.CompletionItemKind {
    switch (category) {
        case 'clause':
            return kinds.Keyword;
        case 'operator':
            return kinds.Operator;
        case 'constant':
            return kinds.Constant;
        case 'keyword':
        default:
            return kinds.Keyword;
    }
}

// ─── Completion Provider ───────────────────────────────────────────────────────

/**
 * Creates a CompletionItemProvider for the CosmosDB NoSQL language.
 *
 * @param monacoInstance
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
            const fullText = model.getValue();

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

            // Parse query context
            const fromAlias = extractFromAlias(fullText);
            const joinAliases: JoinAlias[] = extractJoinAliases(fullText);

            // ── 1. Dot-triggered: only schema property completions ─────────
            const dotMatch = textBeforeCursor.match(/(\w+(?:\.\w+)*)\.(\w*)$/);

            if (dotMatch) {
                const schema = getSchema();
                if (!schema) return { suggestions };

                const fullPath = dotMatch[1]; // e.g. "c.address" or "s"
                const segments = fullPath.split('.');
                const rootAlias = segments[0];

                // Determine the property path to resolve in the schema
                let properties: Record<string, JSONSchema> | undefined;

                // Check if root matches the FROM alias
                if (rootAlias.toLowerCase() === fromAlias.toLowerCase()) {
                    const propertyPath = segments.slice(1);
                    properties = resolveSchemaProperties(schema, propertyPath);
                } else {
                    // Check if root matches a JOIN alias
                    const joinDef = joinAliases.find((j) => j.alias.toLowerCase() === rootAlias.toLowerCase());
                    if (joinDef) {
                        const joinSchema = resolveJoinAliasSchema(schema, joinDef, fromAlias, joinAliases);
                        if (joinSchema) {
                            const propertyPath = segments.slice(1);
                            if (propertyPath.length === 0) {
                                // Direct properties of the JOIN alias schema
                                properties = joinSchema.properties as Record<string, JSONSchema> | undefined;
                            } else {
                                properties = resolveSchemaProperties(joinSchema, propertyPath);
                            }
                        }
                    }
                }

                if (properties) {
                    const dotRange: monaco.IRange = {
                        startLineNumber: position.lineNumber,
                        startColumn: position.column - (dotMatch[2]?.length ?? 0),
                        endLineNumber: position.lineNumber,
                        endColumn: position.column,
                    };

                    for (const [name, propSchema] of Object.entries(properties)) {
                        const typeLabel = getTypeLabel(propSchema as JSONSchema);
                        const hasChildren =
                            !!(propSchema as JSONSchema).properties ||
                            !!(propSchema as JSONSchema).anyOf?.some(
                                (e: JSONSchema) => e.type === 'object' || e.properties,
                            );
                        // Higher occurrence → lower sort key → appears first
                        const occurrence = getOccurrence(propSchema as JSONSchema);
                        const sortKey = String(1e9 - occurrence).padStart(10, '0');

                        if (needsBracketNotation(name)) {
                            suggestions.push({
                                label: {
                                    label: name,
                                    detail: ` (${typeLabel})`,
                                    description: 'bracket notation',
                                } as monaco.languages.CompletionItemLabel,
                                kind: monacoInstance.languages.CompletionItemKind.Field,
                                insertText: `["${name}"]`,
                                range: {
                                    startLineNumber: position.lineNumber,
                                    startColumn: position.column - (dotMatch[2]?.length ?? 0) - 1,
                                    endLineNumber: position.lineNumber,
                                    endColumn: position.column,
                                },
                                detail: typeLabel,
                                sortText: sortKey,
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
                                sortText: sortKey,
                            });
                        }
                    }
                }

                // After dot: ONLY property suggestions, never keywords/functions
                return { suggestions };
            }

            // ── 2. After LIKE keyword: suggest string literal ─────────────
            if (/\bLIKE\s+$/i.test(textBeforeCursor)) {
                suggestions.push({
                    label: '"..."',
                    kind: monacoInstance.languages.CompletionItemKind.Value,
                    insertText: '"$0"',
                    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    detail: 'String literal (double quotes)',
                    sortText: '0',
                });
                suggestions.push({
                    label: "'...'",
                    kind: monacoInstance.languages.CompletionItemKind.Value,
                    insertText: "'$0'",
                    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    detail: 'String literal (single quotes)',
                    sortText: '1',
                });
                return { suggestions };
            }

            // ── 3. Keyword completions ─────────────────────────────────────
            for (const keyword of NOSQL_KEYWORDS) {
                suggestions.push({
                    label: keyword.name,
                    kind: categoryToCompletionKind(keyword.category, monacoInstance.languages.CompletionItemKind),
                    insertText: keyword.snippet,
                    range,
                    detail: keyword.signature,
                    documentation: `${keyword.description}\n\n${keyword.link}`,
                    sortText: `1_${keyword.name}`,
                });
            }

            // ── 4. Function completions ────────────────────────────────────
            for (const func of NOSQL_FUNCTIONS) {
                suggestions.push({
                    label: {
                        label: func.name,
                        detail: `  ${func.signature}`,
                    } as monaco.languages.CompletionItemLabel,
                    kind: monacoInstance.languages.CompletionItemKind.Function,
                    insertText: func.snippet,
                    insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    detail: func.signature,
                    documentation: `${func.description}\n\n${func.link}`,
                    sortText: `2_${func.name}`,
                });
            }

            // ── 5. Alias suggestions (FROM + JOIN aliases) ─────────────────
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

            for (const joinAlias of joinAliases) {
                suggestions.push({
                    label: {
                        label: joinAlias.alias,
                        description: `JOIN alias → ${joinAlias.sourceAlias}.${joinAlias.propertyPath.join('.')}`,
                    } as monaco.languages.CompletionItemLabel,
                    kind: monacoInstance.languages.CompletionItemKind.Variable,
                    insertText: joinAlias.alias,
                    range,
                    detail: `JOIN ${joinAlias.alias} IN ${joinAlias.sourceAlias}.${joinAlias.propertyPath.join('.')}`,
                    sortText: `0_${joinAlias.alias}`,
                });
            }

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
