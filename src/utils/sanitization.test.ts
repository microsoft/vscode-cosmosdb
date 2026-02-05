/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    escapeHtml,
    escapeMarkdown,
    renderAsCodeBlock,
    safeCodeBlock,
    safeErrorDisplay,
    safeJsonDisplay,
    safeMarkdownText,
    sanitizeCommandUri,
    sanitizeSqlComment,
} from './sanitization';

describe('sanitization', () => {
    describe('escapeHtml', () => {
        it('should escape HTML special characters', () => {
            expect(escapeHtml('<script>alert("xss")</script>')).toBe(
                '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
            );
            expect(escapeHtml('test & \'quotes\' and "double"')).toBe(
                'test &amp; &#39;quotes&#39; and &quot;double&quot;',
            );
        });

        it('should handle empty string', () => {
            expect(escapeHtml('')).toBe('');
        });

        it('should handle string without special characters', () => {
            expect(escapeHtml('Hello World')).toBe('Hello World');
        });
    });

    describe('escapeMarkdown', () => {
        it('should escape markdown special characters', () => {
            expect(escapeMarkdown('*bold* _italic_')).toBe('\\*bold\\* \\_italic\\_');
            expect(escapeMarkdown('[link](url)')).toBe('\\[link\\]\\(url\\)');
            expect(escapeMarkdown('# Header')).toBe('\\# Header');
        });

        it('should escape backticks', () => {
            expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
        });

        it('should handle empty string', () => {
            expect(escapeMarkdown('')).toBe('');
        });
    });

    describe('renderAsCodeBlock', () => {
        it('should render inline code by default', () => {
            expect(renderAsCodeBlock('test')).toBe('`test`');
        });

        it('should render block code when inline is false', () => {
            expect(renderAsCodeBlock('test', false)).toBe('```\ntest\n```');
        });

        it('should escape backticks in inline code', () => {
            expect(renderAsCodeBlock('test`with`backticks')).toBe('`test\\`with\\`backticks`');
        });

        it('should escape backslashes in inline code', () => {
            expect(renderAsCodeBlock('test\\with\\backslashes')).toBe('`test\\\\with\\\\backslashes`');
        });

        it('should escape both backslashes and backticks in inline code', () => {
            expect(renderAsCodeBlock('test\\`combined')).toBe('`test\\\\\\`combined`');
        });

        it('should escape triple backticks in block code', () => {
            expect(renderAsCodeBlock('code with ``` inside', false)).toBe('```\ncode with ` ``  inside\n```');
        });
    });

    describe('sanitizeCommandUri', () => {
        it('should allow valid command URIs', () => {
            expect(sanitizeCommandUri('command:cosmosDB.openDocument')).toBe('command:cosmosDB.openDocument');
            expect(sanitizeCommandUri('command:vscode.open')).toBe('command:vscode.open');
            expect(sanitizeCommandUri('command:my-command_123')).toBe('command:my-command_123');
        });

        it('should reject invalid command URIs', () => {
            expect(sanitizeCommandUri('javascript:alert(1)')).toBeNull();
            expect(sanitizeCommandUri('command:evil$(rm -rf /)')).toBeNull();
            expect(sanitizeCommandUri('command:test;malicious')).toBeNull();
            expect(sanitizeCommandUri('command:test<script>')).toBeNull();
        });

        it('should reject non-command URIs', () => {
            expect(sanitizeCommandUri('http://example.com')).toBeNull();
            expect(sanitizeCommandUri('file:///etc/passwd')).toBeNull();
        });
    });

    describe('safeMarkdownText', () => {
        it('should escape both HTML and markdown', () => {
            const input = '<script>alert("test")</script> *bold*';
            const result = safeMarkdownText(input);
            expect(result).toContain('&lt;script&gt;');
            expect(result).toContain('\\*bold\\*');
        });

        it('should handle XSS attempts', () => {
            const xssPayload = '<img src=x onerror=alert(1)>';
            const result = safeMarkdownText(xssPayload);
            expect(result).not.toContain('<img');
            expect(result).toContain('&lt;img');
        });
    });

    describe('safeJsonDisplay', () => {
        it('should display JSON inline by default', () => {
            const obj = { name: 'test', value: 123 };
            const result = safeJsonDisplay(obj);
            expect(result).toMatch(/^`.*`$/);
            expect(result).toContain('test');
        });

        it('should display JSON as block when inline is false', () => {
            const obj = { name: 'test' };
            const result = safeJsonDisplay(obj, false);
            expect(result).toMatch(/^```\n.*\n```$/s);
        });

        it('should handle objects with special characters', () => {
            const obj = { script: '<script>alert(1)</script>', backtick: '`test`' };
            const result = safeJsonDisplay(obj);
            // Should be wrapped in code block which prevents execution
            expect(result).toMatch(/^`.*`$/);
        });

        it('should handle circular references gracefully', () => {
            const obj: { self?: unknown } = {};
            obj.self = obj;
            const result = safeJsonDisplay(obj);
            expect(result).toBe('`[invalid JSON]`');
        });
    });

    describe('safeErrorDisplay', () => {
        it('should display error message with prefix', () => {
            const error = new Error('Something went wrong');
            const result = safeErrorDisplay(error);
            expect(result).toBe('❌ Something went wrong');
        });

        it('should display string error with prefix', () => {
            const result = safeErrorDisplay('Error occurred');
            expect(result).toBe('❌ Error occurred');
        });

        it('should use custom prefix', () => {
            const error = new Error('Test');
            const result = safeErrorDisplay(error, '⚠️');
            expect(result).toBe('⚠️ Test');
        });

        it('should escape special characters in error messages', () => {
            const error = new Error('<script>alert("xss")</script>');
            const result = safeErrorDisplay(error);
            expect(result).toContain('&lt;script&gt;');
            expect(result).not.toContain('<script>');
        });

        it('should escape markdown in error messages', () => {
            const error = new Error('Error with *markdown* and [link](url)');
            const result = safeErrorDisplay(error);
            expect(result).toContain('\\*markdown\\*');
            expect(result).toContain('\\[link\\]');
        });
    });

    describe('safeCodeBlock', () => {
        it('should wrap content in code block', () => {
            const result = safeCodeBlock('SELECT * FROM c');
            expect(result).toBe('```\nSELECT * FROM c\n```');
        });

        it('should support language identifier', () => {
            const result = safeCodeBlock('SELECT * FROM c', 'sql');
            expect(result).toBe('```sql\nSELECT * FROM c\n```');
        });

        it('should escape triple backticks in content', () => {
            const result = safeCodeBlock('code with ``` inside', 'javascript');
            expect(result).toBe('```javascript\ncode with ` ``  inside\n```');
        });

        it('should handle multiline content', () => {
            const content = 'line1\nline2\nline3';
            const result = safeCodeBlock(content, 'sql');
            expect(result).toBe('```sql\nline1\nline2\nline3\n```');
        });
    });

    describe('sanitizeSqlComment', () => {
        it('should replace newlines with spaces', () => {
            const result = sanitizeSqlComment('line1\nline2\nline3');
            expect(result).toBe('line1 line2 line3');
        });

        it('should handle Windows line endings', () => {
            const result = sanitizeSqlComment('line1\r\nline2\r\nline3');
            expect(result).toBe('line1 line2 line3');
        });

        it('should handle Mac line endings', () => {
            const result = sanitizeSqlComment('line1\rline2\rline3');
            expect(result).toBe('line1 line2 line3');
        });

        it('should replace tabs with spaces', () => {
            const result = sanitizeSqlComment('word1\tword2\tword3');
            expect(result).toBe('word1 word2 word3');
        });

        it('should trim leading and trailing whitespace', () => {
            const result = sanitizeSqlComment('  text with spaces  ');
            expect(result).toBe('text with spaces');
        });

        it('should prevent SQL comment injection', () => {
            const malicious = 'user input\n; DROP TABLE users; --';
            const result = sanitizeSqlComment(malicious);
            expect(result).not.toContain('\n');
            expect(result).toBe('user input ; DROP TABLE users; --');
        });

        it('should handle multiline prompt safely', () => {
            const multilinePrompt = 'Show me all users\nwhere status is active\nand age > 18';
            const result = sanitizeSqlComment(multilinePrompt);
            expect(result).toBe('Show me all users where status is active and age > 18');
        });
    });

    describe('XSS prevention scenarios', () => {
        it('should prevent XSS via error messages', () => {
            const maliciousError = new Error('Error: <img src=x onerror=alert(document.cookie)>');
            const result = safeErrorDisplay(maliciousError);
            expect(result).not.toMatch(/<img/);
            expect(result).toContain('&lt;img');
        });

        it('should prevent XSS via JSON parameters', () => {
            const maliciousParams = {
                query: '</script><script>alert(1)</script><script>',
                name: '<img src=x onerror=alert(1)>',
            };
            const result = safeJsonDisplay(maliciousParams);
            // Content should be in code block, preventing execution
            expect(result).toMatch(/^`.*`$/);
        });

        it('should prevent markdown injection in explanations', () => {
            const maliciousExplanation = '[Click me](javascript:alert(1)) or <script>alert(2)</script>';
            const result = safeMarkdownText(maliciousExplanation);
            // Should escape both markdown links and HTML
            expect(result).toContain('\\[Click me\\]');
            expect(result).toContain('&lt;script&gt;');
        });

        it('should prevent command URI injection', () => {
            const maliciousCommand = 'command:workbench.action.terminal.sendSequence;{"text":"rm -rf /"}';
            const result = sanitizeCommandUri(maliciousCommand);
            // Should reject commands with semicolons
            expect(result).toBeNull();
        });
    });
});
