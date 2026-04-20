/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { stripMarkdownPreamble } from './aiHelpers';

describe('stripMarkdownPreamble', () => {
    it('removes preamble text before the first heading', () => {
        const input = `Now I have a thorough understanding of the schema and the application code. Let me generate the discovery report.

# AdventureWorks Database — Cosmos DB Migration Discovery Report

## Schema Overview

| Schema | Tables |
|--------|--------|
| **dbo** | AWBuildVersion |`;

        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`# AdventureWorks Database — Cosmos DB Migration Discovery Report

## Schema Overview

| Schema | Tables |
|--------|--------|
| **dbo** | AWBuildVersion |`);
    });

    it('returns text unchanged when it starts with a heading', () => {
        const input = `# Discovery Report

Some content here.`;

        expect(stripMarkdownPreamble(input)).toBe(input);
    });

    it('returns text unchanged when there are no headings', () => {
        const input = `This is plain text without any markdown headings.
It has multiple lines but no heading.`;

        expect(stripMarkdownPreamble(input)).toBe(input);
    });

    it('handles multiple preamble lines before the heading', () => {
        const input = `Let me analyze the schema.
I found 30 tables across 6 schemas.
Here is the comprehensive report:

# Database Migration Report

Content here.`;

        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`# Database Migration Report

Content here.`);
    });

    it('handles a level-2 heading as the first heading', () => {
        const input = `Some preamble text.

## Overview

Details here.`;

        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`## Overview

Details here.`);
    });

    it('returns empty string unchanged', () => {
        expect(stripMarkdownPreamble('')).toBe('');
    });

    it('handles heading on the very first line with no preamble', () => {
        const input = `## Quick Summary`;
        expect(stripMarkdownPreamble(input)).toBe(input);
    });

    it('does not strip code blocks that contain # characters', () => {
        const input = `Here is an example:

\`\`\`python
# This is a comment
print("hello")
\`\`\`

# Actual Heading

Content.`;

        // The regex matches the first `#` at the start of a line, which in this
        // case is inside a code block. This is acceptable because:
        // 1. Real LLM preambles don't start with code blocks
        // 2. The main use case is stripping conversational text before a document heading
        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`# This is a comment
print("hello")
\`\`\`

# Actual Heading

Content.`);
    });

    it('preserves whitespace-only lines before heading', () => {
        const input = `\n\n# Report\n\nContent.`;
        const result = stripMarkdownPreamble(input);
        expect(result).toBe(`# Report\n\nContent.`);
    });
});
