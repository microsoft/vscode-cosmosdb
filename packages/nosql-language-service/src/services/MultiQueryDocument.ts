/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Multi-query document support
//
// Splits a document containing multiple semicolon-separated queries into
// independent regions, each with its own parse result and offset mapping.
// ---------------------------------------------------------------------------

import { type ParseResult, parse } from '../index.js';
import { SqlLexer } from '../lexer/SqlLexer.js';
import { Semicolon } from '../lexer/tokens.js';

// ========================== Types =============================================

/**
 * A single query region within a multi-query document.
 */
export interface QueryRegion {
    /** 0-based index of this region. */
    readonly index: number;
    /** Query text (without the trailing `;`). */
    readonly text: string;
    /** Start offset in the full document (inclusive). */
    readonly startOffset: number;
    /** End offset in the full document (exclusive, includes `;` if present). */
    readonly endOffset: number;
    /** Parse result for this region. `null` if region is empty/whitespace-only. */
    readonly parseResult: ParseResult | null;
}

/**
 * Parsed representation of a document containing one or more
 * semicolon-separated queries. Provides offset mapping between
 * document-level and region-local coordinates.
 */
export interface MultiQueryDocument {
    /** Ordered list of query regions. */
    readonly regions: readonly QueryRegion[];

    /** Find the region containing the given document offset. */
    regionAtOffset(offset: number): QueryRegion | undefined;

    /**
     * Convert a document offset to a local offset within a region.
     * Returns `undefined` if the offset is outside all regions.
     */
    toLocalOffset(offset: number): { region: QueryRegion; localOffset: number } | undefined;

    /**
     * Convert a local region offset back to a document offset.
     */
    toDocumentOffset(region: QueryRegion, localOffset: number): number;
}

// ========================== Implementation =====================================

/**
 * Parse a document that may contain multiple semicolon-separated queries
 * into a {@link MultiQueryDocument}.
 *
 * The lexer tokenizes the full document once to locate `Semicolon` tokens
 * (this correctly ignores semicolons inside string literals and comments).
 * Each region between semicolons is then parsed independently.
 *
 * @param text - The full document text.
 * @returns A {@link MultiQueryDocument} with all regions parsed.
 */
export function parseMultiQueryDocument(text: string): MultiQueryDocument {
    // Tokenize once to find semicolon positions
    const lexResult = SqlLexer.tokenize(text);
    const semicolonOffsets: number[] = [];

    for (const token of lexResult.tokens) {
        if (token.tokenType === Semicolon) {
            semicolonOffsets.push(token.startOffset);
        }
    }

    // Build regions by splitting at semicolons
    const regions: QueryRegion[] = [];
    let regionStart = 0;

    for (let i = 0; i < semicolonOffsets.length; i++) {
        const semiOffset = semicolonOffsets[i];
        const regionText = text.substring(regionStart, semiOffset);
        regions.push(createRegion(regions.length, regionText, regionStart, semiOffset + 1));
        regionStart = semiOffset + 1;
    }

    // Last region (after the last semicolon, or the entire text if no semicolons)
    if (regionStart <= text.length) {
        const regionText = text.substring(regionStart);
        regions.push(createRegion(regions.length, regionText, regionStart, text.length));
    }

    return new MultiQueryDocumentImpl(regions);
}

function createRegion(index: number, text: string, startOffset: number, endOffset: number): QueryRegion {
    const trimmed = text.trim();
    const parseResult = trimmed.length > 0 ? parse(text) : null;

    return {
        index,
        text,
        startOffset,
        endOffset,
        parseResult,
    };
}

class MultiQueryDocumentImpl implements MultiQueryDocument {
    readonly regions: readonly QueryRegion[];

    constructor(regions: QueryRegion[]) {
        this.regions = regions;
    }

    regionAtOffset(offset: number): QueryRegion | undefined {
        for (const region of this.regions) {
            if (offset >= region.startOffset && offset < region.endOffset) {
                return region;
            }
        }
        // If offset is exactly at the end of the document, return the last region
        if (this.regions.length > 0 && offset === this.regions[this.regions.length - 1].endOffset) {
            return this.regions[this.regions.length - 1];
        }
        return undefined;
    }

    toLocalOffset(offset: number): { region: QueryRegion; localOffset: number } | undefined {
        const region = this.regionAtOffset(offset);
        if (!region) return undefined;
        return {
            region,
            localOffset: offset - region.startOffset,
        };
    }

    toDocumentOffset(region: QueryRegion, localOffset: number): number {
        return region.startOffset + localOffset;
    }
}

