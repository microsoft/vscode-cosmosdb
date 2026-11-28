import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSchemaConversionSummary } from '../scripts/validate-schema-conversion-summary.mjs';
import { VALID_DOMAIN_SUMMARY, VALID_ROOT_SUMMARY } from './schema-conversion-summary-fixtures.mjs';

test('accepts complete domain and root summaries', () => {
    assert.deepEqual(
        validateSchemaConversionSummary(VALID_DOMAIN_SUMMARY, 'domain', {
            expectedDocTypes: ['item', 'order'],
            expectedPatternIds: ['R001'],
        }),
        [],
    );
    assert.deepEqual(validateSchemaConversionSummary(VALID_ROOT_SUMMARY, 'root'), []);
});

test('requires every expected discovery pattern in the access-pattern mapping section', () => {
    const errors = validateSchemaConversionSummary(VALID_DOMAIN_SUMMARY, 'domain', {
        expectedPatternIds: ['R001', 'W002'],
    });
    assert.deepEqual(
        errors.filter(error => error.path.startsWith('$.sections.accessPatterns.')),
        [
            {
                path: '$.sections.accessPatterns.W002',
                message: 'missing mapping for discovered access pattern W002',
            },
        ],
    );

    const outsideSection = VALID_DOMAIN_SUMMARY
        .replace('R001 maps to a partition-routed point read.', 'No mapped patterns.')
        .replace('Complete domain design.', 'Complete domain design for R001.');
    assert(
        validateSchemaConversionSummary(outsideSection, 'domain', { expectedPatternIds: ['R001'] })
            .some(error => error.path === '$.sections.accessPatterns.R001'),
    );
});

test('reports missing domain design sections', () => {
    const errors = validateSchemaConversionSummary('# Orders\n', 'domain');
    assert(errors.some((error) => error.path === '$.sections.partitionKeys'));
    assert(errors.some((error) => error.path === '$.sections.accessPatterns'));
});

test('requires a domain example document and capacity evidence tag', () => {
    const withoutExample = VALID_DOMAIN_SUMMARY.replace(/```json[\s\S]*?```/gu, 'No example.');
    assert(validateSchemaConversionSummary(withoutExample, 'domain').some((error) => error.path === '$.examples'));

    const withoutTags = VALID_DOMAIN_SUMMARY.replace('[volumetrics] [access patterns]', 'estimated');
    assert(
        validateSchemaConversionSummary(withoutTags, 'domain').some((error) => error.path === '$.capacityInputs'),
    );
});

test('requires an example document for every canonical docType', () => {
    const errors = validateSchemaConversionSummary(VALID_DOMAIN_SUMMARY, 'domain', {
        expectedDocTypes: ['order', 'payment'],
    });
    assert(errors.some((error) => error.message === 'missing JSON example for docType payment'));
});

test('rejects minified JSON example documents', () => {
    const minified = VALID_DOMAIN_SUMMARY.replace(
        '{\n  "id": "order-1",\n  "docType": "order"\n}',
        '{"id":"order-1","docType":"order"}',
    );
    const errors = validateSchemaConversionSummary(minified, 'domain');
    assert(
        errors.some(
            (error) =>
                error.path === '$.examples[0]' && error.message.includes('readable JSON with two-space indentation'),
        ),
    );
});

test('reports missing root deployment sections', () => {
    const errors = validateSchemaConversionSummary('# Root\n\n## Database Overview\nDatabase.\n', 'root');
    assert(errors.some((error) => error.path === '$.sections.deployment'));
    assert(errors.some((error) => error.path === '$.sections.domains'));
});
