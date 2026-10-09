import assert from 'node:assert/strict';
import test from 'node:test';
import { selectSchemaConversionDomains } from '../scripts/select-schema-conversion-domains.mjs';

function projectWithDomains(domains) {
    return {
        version: 1,
        name: 'migration-app',
        sourceCode: 'parent',
        phases: {
            discovery: { status: 'complete' },
            assessment: { status: 'complete', domains },
        },
    };
}

const ORDERS = {
    name: 'Orders',
    tables: ['dbo.OrderLines', 'dbo.Orders'],
    crossDomainDependencies: [],
    estimatedTokens: 1000,
    isMapped: true,
};
const CATALOG = {
    name: 'Catalog',
    tables: ['dbo.Products'],
    crossDomainDependencies: [],
    estimatedTokens: 500,
    isMapped: false,
};

test('selects mapped domains and reports skipped domains by default', () => {
    const result = selectSchemaConversionDomains(projectWithDomains([ORDERS, CATALOG]));
    assert.deepEqual(result.selectedDomains, [{ name: 'Orders', tables: ['dbo.OrderLines', 'dbo.Orders'] }]);
    assert.deepEqual(result.skippedDomains, [
        { name: 'Catalog', tables: ['dbo.Products'], reason: 'no detected application mapping' },
    ]);
});

test('includes all assessed domains only when requested', () => {
    const result = selectSchemaConversionDomains(projectWithDomains([ORDERS, CATALOG]), true);
    assert.deepEqual(
        result.selectedDomains.map((domain) => domain.name),
        ['Catalog', 'Orders'],
    );
    assert.deepEqual(result.skippedDomains, []);
});

test('blocks rather than silently widening an empty default selection', () => {
    assert.throws(
        () => selectSchemaConversionDomains(projectWithDomains([CATALOG])),
        /--include-unmapped-domains/u,
    );
});

test('rejects duplicate assessment domain names', () => {
    assert.throws(
        () => selectSchemaConversionDomains(projectWithDomains([ORDERS, { ...ORDERS }])),
        /duplicated: Orders/u,
    );
});
