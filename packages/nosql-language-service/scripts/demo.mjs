#!/usr/bin/env node

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Demo: parser error-recovery and completion with invalid/incomplete queries.
//
// Usage:  node scripts/demo.mjs          (requires prior `pnpm run build`)
// ---------------------------------------------------------------------------

// eslint-disable-next-line import/no-internal-modules
import { getCompletions } from '../dist/esm/completion/SqlCompletion.js';
// eslint-disable-next-line import/no-internal-modules
import { parse } from '../dist/esm/index.js';

const schema = {
    properties: {
        id: { 'x-occurrence': 100, type: 'string' },
        name: { 'x-occurrence': 95, type: 'string' },
        age: { 'x-occurrence': 90, type: 'number' },
        address: {
            'x-occurrence': 80,
            type: 'object',
            properties: {
                city: { 'x-occurrence': 75, type: 'string' },
                state: { 'x-occurrence': 70, type: 'string' },
            },
        },
    },
};

console.log('=== 1. Completely empty query ===');
{
    const { ast, errors } = parse('');
    console.log('  AST:', ast ? ast.kind : 'none');
    console.log(
        '  Errors:',
        errors.length,
        errors.map((e) => e.code),
    );
    const items = getCompletions({ query: '', offset: 0, schema });
    console.log(
        '  Completions:',
        items.map((i) => i.label),
    );
}

console.log("\n=== 2. Just 'SELECT' (incomplete) ===");
{
    const { ast, errors } = parse('SELECT');
    console.log('  AST:', ast?.kind, 'select spec:', ast?.query?.select?.spec?.kind);
    console.log(
        '  Errors:',
        errors.length,
        errors.map((e) => `${e.code}: ${e.message.slice(0, 60)}`),
    );
    const items = getCompletions({ query: 'SELECT ', offset: 7, schema });
    console.log("  Completions after 'SELECT ':", items.map((i) => `${i.label}(${i.kind})`).slice(0, 8));
}

console.log("\n=== 3. Typo: 'SELECT * FORM c' (FORM instead of FROM) ===");
{
    const { ast, errors } = parse('SELECT * FORM c');
    console.log('  AST:', ast?.kind);
    console.log('  Has select?', !!ast?.query?.select);
    console.log('  Has from?', !!ast?.query?.from);
    console.log(
        '  Errors:',
        errors.map((e) => `${e.code}: ${e.message.slice(0, 80)}`),
    );
}

console.log("\n=== 4. Incomplete WHERE: 'SELECT * FROM c WHERE' ===");
{
    const { ast, errors } = parse('SELECT * FROM c WHERE');
    console.log('  AST:', ast?.kind, 'has where?', !!ast?.query?.where);
    console.log(
        '  Errors:',
        errors.length,
        errors.map((e) => e.code),
    );
    const items = getCompletions({ query: 'SELECT * FROM c WHERE ', offset: 22, schema });
    console.log('  Completions:', items.map((i) => `${i.label}(${i.kind})`).slice(0, 8));
}

console.log("\n=== 5. Dot completion mid-typing: 'SELECT c.' ===");
{
    const { ast, errors } = parse('SELECT c.');
    console.log('  AST:', ast?.kind);
    console.log('  Errors:', errors.length);
    const items = getCompletions({ query: 'SELECT c.', offset: 9, schema });
    console.log(
        '  Completions:',
        items.map((i) => `${i.label}: ${i.detail}`),
    );
}

console.log("\n=== 6. Nested dot: 'SELECT c.address.' ===");
{
    const items = getCompletions({ query: 'SELECT c.address.', offset: 17, schema });
    console.log(
        '  Completions:',
        items.map((i) => `${i.label}: ${i.detail}`),
    );
}

console.log("\n=== 7. Partial typing: 'SELECT c.na' ===");
{
    const items = getCompletions({ query: 'SELECT c.na', offset: 11, schema });
    console.log(
        '  Completions:',
        items.map((i) => `${i.label}: ${i.detail}`),
    );
}

console.log("\n=== 8. Broken middle: 'SELECT c.id, , c.name FROM c' ===");
{
    const { ast, errors } = parse('SELECT c.id, , c.name FROM c');
    console.log('  AST:', ast?.kind);
    console.log('  Has select list?', ast?.query?.select?.spec?.kind);
    console.log(
        '  Errors:',
        errors.map((e) => `${e.code}: ${e.message.slice(0, 60)}`),
    );
}

console.log("\n=== 9. Function mid-typing: 'SELECT COUNT(' ===");
{
    const items = getCompletions({ query: 'SELECT COUNT(', offset: 13, schema });
    console.log('  Completions:', items.map((i) => `${i.label}(${i.kind})`).slice(0, 6));
}

console.log("\n=== 10. After FROM clause: 'SELECT * FROM c ' ===");
{
    const items = getCompletions({ query: 'SELECT * FROM c ', offset: 16, schema });
    console.log(
        '  Completions:',
        items.map((i) => `${i.label}(${i.kind})`),
    );
}
