/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Monaco HoverProvider for CosmosDB NoSQL query language.
 *
 * Shows inline documentation for keywords and built-in functions
 * when the cursor hovers over them in the webview Query Editor.
 * Also shows schema property info (type, occurrence) when hovering
 * over dot-path expressions like `c.address.city`.
 */
import type * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { getCursorContext } from '../../../../cosmosdb/language/AST';
import { getNoSqlHoverContent, getNoSqlSchemaPropertyHoverContent } from '../../../../cosmosdb/language/nosqlHover';
import { NOSQL_LANGUAGE_ID } from '../../../../cosmosdb/language/nosqlLanguageDefinitions';
import { resolvePropertyAtPath } from '../../../../cosmosdb/language/nosqlParser';
import { type JSONSchema } from '../../../../utils/json/JSONSchema';

/**
 * Creates a HoverProvider for the CosmosDB NoSQL language.
 *
 * @param monacoInstance
 * @param getSchema - Returns the current container schema (or null). Called on every hover.
 */
export function createNoSqlHoverProvider(
    monacoInstance: typeof monaco,
    getSchema: () => JSONSchema | null,
): monaco.languages.HoverProvider {
    return {
        provideHover(
            model: monaco.editor.ITextModel,
            position: monaco.Position,
        ): monaco.languages.ProviderResult<monaco.languages.Hover> {
            const wordInfo = model.getWordAtPosition(position);
            if (!wordInfo) {
                return null;
            }

            const lineContent = model.getLineContent(position.lineNumber);
            // Extend left from the end of the current word to capture the full dot-path
            // e.g. cursor on "city" in "c.address.city" → captures "c.address.city"
            const textToWordEnd = lineContent.substring(0, wordInfo.endColumn - 1);
            const dotPathMatch = textToWordEnd.match(/(\w+(?:\.\w+)+)$/);

            // ── 1. Schema property hover (dot-path context) ───────────────
            if (dotPathMatch) {
                const schema = getSchema();
                if (schema) {
                    const fullText = model.getValue();
                    const cursorOffset = model.getOffsetAt(position);
                    const { fromAlias, joinAliases } = getCursorContext(fullText, cursorOffset);
                    const dotPath = dotPathMatch[1];

                    const resolved = resolvePropertyAtPath(schema, dotPath, fromAlias, joinAliases);
                    if (resolved) {
                        const documentsInspected = schema['x-documentsInspected'] as number | undefined;
                        const content = getNoSqlSchemaPropertyHoverContent(
                            resolved.propSchema,
                            resolved.propertyName,
                            documentsInspected,
                        );
                        return {
                            range: new monacoInstance.Range(
                                position.lineNumber,
                                wordInfo.startColumn,
                                position.lineNumber,
                                wordInfo.endColumn,
                            ),
                            contents: [{ value: content.markdown, isTrusted: true, supportHtml: true }],
                        };
                    }
                }
            }

            // ── 2. Keyword / function hover ───────────────────────────────
            const content = getNoSqlHoverContent(wordInfo.word);
            if (!content) {
                return null;
            }

            return {
                range: new monacoInstance.Range(
                    position.lineNumber,
                    wordInfo.startColumn,
                    position.lineNumber,
                    wordInfo.endColumn,
                ),
                contents: [{ value: content.markdown, isTrusted: true, supportHtml: true }],
            };
        },
    };
}

/**
 * Registers the NoSQL hover provider with Monaco.
 * Returns a disposable that should be cleaned up when no longer needed.
 */
export function registerNoSqlHoverProvider(
    monacoInstance: typeof monaco,
    getSchema: () => JSONSchema | null,
): monaco.IDisposable {
    return monacoInstance.languages.registerHoverProvider(
        NOSQL_LANGUAGE_ID,
        createNoSqlHoverProvider(monacoInstance, getSchema),
    );
}
