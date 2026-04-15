/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// IDE-agnostic language service types
//
// These types describe language features (diagnostics, hover, signature
// help, formatting) without depending on any editor SDK.  Every editor
// provider maps FROM these types TO its own API.
// ---------------------------------------------------------------------------

// ========================== Text range ========================================

import { type JSONSchema } from '../completion/SqlCompletion.js';

/**
 * A contiguous range of text inside a query string.
 * Uses 1-based line/column for broad editor compatibility.
 */
export interface TextRange {
    /** 0-based start offset (bytes) */
    startOffset: number;
    /** 0-based end offset (bytes, exclusive) */
    endOffset: number;
    /** 1-based start line */
    startLine: number;
    /** 1-based start column */
    startColumn: number;
    /** 1-based end line */
    endLine: number;
    /** 1-based end column (exclusive) */
    endColumn: number;
}

// ========================== Diagnostics ======================================

export enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

/**
 * A single diagnostic (error / warning) produced by parsing a query.
 */
export interface Diagnostic {
    /** Where in the source the problem was detected */
    range: TextRange;
    /** Human-readable description */
    message: string;
    /** Severity level */
    severity: DiagnosticSeverity;
    /** Machine-readable error code (e.g. `UNEXPECTED_TOKEN`) */
    code?: string;
    /** Optional grouping source (e.g. `"cosmosdb-sql"`) */
    source?: string;
}

// ========================== Hover =============================================

/**
 * Hover information for a token at a given position.
 */
export interface HoverInfo {
    /** Markdown or plain-text content blocks to display */
    contents: string[];
    /** The source range of the hovered token */
    range?: TextRange;
}

// ========================== Signature help ====================================

/**
 * Describes one parameter of a function signature.
 */
export interface ParameterInfo {
    /** Parameter label (e.g. `"expression"`) */
    label: string;
    /** Optional documentation for this parameter */
    documentation?: string;
}

/**
 * A single function signature with its parameters.
 */
export interface SignatureInfo {
    /** Full signature label (e.g. `"CONTAINS(str, substr [, ignoreCase])"`) */
    label: string;
    /** Optional documentation for the function */
    documentation?: string;
    /** Parameter descriptions */
    parameters: ParameterInfo[];
}

/**
 * Signature help result — which signatures are active and which
 * parameter the cursor is at.
 */
export interface SignatureHelpResult {
    /** Available overloads / signatures */
    signatures: SignatureInfo[];
    /** Index of the active signature */
    activeSignature: number;
    /** Index of the active parameter within the active signature */
    activeParameter: number;
}

// ========================== Formatting ========================================

/**
 * A text edit returned by the formatter — replace `range` with `newText`.
 */
export interface TextEdit {
    range: TextRange;
    newText: string;
}

// ========================== Multi-query visual features =======================

/**
 * A foldable region described by document-level byte offsets.
 * Content offsets exclude leading/trailing whitespace so that
 * fold ranges start at the first real token of each query.
 */
export interface FoldableRegion {
    /** Offset of the first non-whitespace character in the region. */
    readonly contentStartOffset: number;
    /** Offset just past the last non-whitespace character in the region. */
    readonly contentEndOffset: number;
}

/**
 * Position of a separator line between two query regions.
 */
export interface SeparatorPosition {
    /** Offset of the semicolon that ends the region (separator drawn on this line). */
    readonly semicolonOffset: number;
}

// ========================== Language service host =============================

/**
 * Configuration callback interface that the host (editor, app) can
 * implement to feed runtime data into the language service.
 *
 * Every method is optional — the service degrades gracefully when
 * a method is not provided.
 */
export interface LanguageServiceHost {
    /**
     * Return the JSON Schema of the current collection.
     * Used for field completions and hover type info.
     */
    getSchema?(): JSONSchema | undefined;

    /**
     * Return extra collection aliases that cannot be detected from
     * the query alone (e.g. from a multi-statement context).
     */
    getAliases?(): string[] | undefined;

    /**
     * Enable multi-query document support. When `true`, the service
     * splits input by semicolons and routes each language feature
     * to the correct query region. Default: `false`.
     */
    multiQuery?: boolean;
}

// ========================== Disposable ========================================

/**
 * Minimal disposable interface (matches VS Code, Monaco, and most
 * reactive frameworks).
 */
export interface Disposable {
    dispose(): void;
}
