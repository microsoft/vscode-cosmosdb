import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildCompatibilityReport,
    classifyLanguage,
    MATRIX_VERIFIED_AT,
    SDK_OVERVIEW_URL,
    validateCompatibilityReport,
} from '../scripts/check-sdk-compatibility.mjs';

test('classifies stable first-party SDK languages', () => {
    for (const language of ['C#', 'TypeScript', 'Java', 'Python', 'Go']) {
        const result = classifyLanguage(language);
        assert.equal(result.status, 'supported', language);
        assert.equal(result.interoperability, false, language);
        assert(result.package, language);
    }
});

test('classifies runtime-interoperable languages with a warning', () => {
    for (const language of ['F#', 'Visual Basic .NET', 'Kotlin', 'Scala']) {
        const result = classifyLanguage(language);
        assert.equal(result.status, 'supported', language);
        assert.equal(result.interoperability, true, language);
        assert.match(result.warning, /runtime interoperability/u);
    }
});

test('classifies Rust as preview without blocking analytical phases', () => {
    const report = buildCompatibilityReport(['Rust']);
    assert.equal(report.overallStatus, 'preview');
    assert.equal(report.analyticalPhasesAllowed, true);
    assert.equal(report.codeMigrationAllowed, true);
    assert.match(report.results[0].documentation, /quickstart-rust/u);
});

test('warns for Perl but permits discovery through provisioning and blocks only code migration', () => {
    const report = buildCompatibilityReport(['Perl']);
    assert.equal(report.overallStatus, 'unsupported');
    assert.equal(report.analyticalPhasesAllowed, true);
    assert.equal(report.codeMigrationAllowed, false);
    assert.match(report.results[0].warning, /Continue from discovery through provisioning/u);
    assert.doesNotMatch(report.results[0].warning, /REST/iu);
    assert.equal(report.results[0].documentation, SDK_OVERVIEW_URL);
});

test('builds deterministic polyglot reports and recommends documentation refresh', () => {
    const first = buildCompatibilityReport(['Perl', 'TypeScript', 'TypeScript']);
    const second = buildCompatibilityReport(['TypeScript', 'Perl']);
    assert.deepEqual(first, second);
    assert.equal(first.matrixVerifiedAt, MATRIX_VERIFIED_AT);
    assert.equal(first.onlineDocumentationRefreshRecommended, true);
});

test('validates generated reports and derives migration permission without blocking analysis', () => {
    for (const languages of [['C#', 'TypeScript', 'Java', 'Python', 'Go'], ['F#', 'Kotlin'], ['Rust'], ['Perl'], ['TypeScript', 'Perl']]) {
        const report = buildCompatibilityReport(languages);
        const before = structuredClone(report);
        const result = validateCompatibilityReport(report, languages);
        assert.deepEqual(result.errors, []);
        assert.equal(result.codeMigrationAllowed, !languages.includes('Perl'));
        assert.equal(report.analyticalPhasesAllowed, true);
        assert.deepEqual(report, before);
    }
});

test('rejects empty classifications and normalizes case and whitespace consistently', () => {
    assert.throws(() => buildCompatibilityReport([]), /at least one language/u);
    assert.throws(() => buildCompatibilityReport([' ']), /at least one language/u);
    const report = buildCompatibilityReport([' TypeScript ', 'typescript']);
    assert.equal(report.results.length, 1);
    assert.deepEqual(report, buildCompatibilityReport(['typescript', ' TypeScript ']));
    assert.deepEqual(validateCompatibilityReport(report, ['TYPESCRIPT']).errors, []);
    assert(validateCompatibilityReport({ ...report, results: [] }, ['TypeScript']).errors.length > 0);
    assert(validateCompatibilityReport(report, []).errors.length > 0);
    assert(validateCompatibilityReport(report, undefined).errors.length > 0);
});

test('rejects contradictory permission and status even when report bytes can be hashed', () => {
    for (const [field, value] of [['codeMigrationAllowed', true], ['overallStatus', 'supported'], ['analyticalPhasesAllowed', false]]) {
        const report = buildCompatibilityReport(['Perl']);
        report[field] = value;
        const result = validateCompatibilityReport(report, ['Perl']);
        assert(result.errors.some(error => error.path === `$.${field}`));
        assert.equal(result.codeMigrationAllowed, false);
    }
});

test('rejects missing, extra, duplicate, forged and malformed language evidence', () => {
    const cases = [
        report => { report.results = []; },
        report => { report.results.push(structuredClone(report.results[0])); },
        report => { report.results[0] = classifyLanguage('TypeScript'); report.overallStatus = 'supported'; report.codeMigrationAllowed = true; },
        report => { Object.assign(report.results[0], { status: 'supported', sdkFamily: 'nodejs', sdkDisplayName: 'Node.js', package: '@azure/cosmos' }); report.overallStatus = 'supported'; report.codeMigrationAllowed = true; },
        report => { report.results[0] = null; },
        report => { report.matrixVersion = 999; },
    ];
    for (const mutate of cases) {
        const report = buildCompatibilityReport(['Perl']);
        mutate(report);
        const result = validateCompatibilityReport(report, ['Perl']);
        assert(result.errors.length > 0);
        assert.equal(result.codeMigrationAllowed, false);
    }
    assert(validateCompatibilityReport(buildCompatibilityReport(['TypeScript']), ['TypeScript', 'Perl']).errors.some(error => error.message.includes('perl')));
    assert(validateCompatibilityReport(buildCompatibilityReport(['TypeScript', 'Perl']), ['TypeScript']).errors.length > 0);
    for (const report of [null, [], {}, { version: 1, codeMigrationAllowed: true }]) {
        assert.equal(validateCompatibilityReport(report, ['Perl']).codeMigrationAllowed, false);
    }
});

function reportWithOverride() {
    const report = buildCompatibilityReport(['Rust']);
    const result = report.results[0];
    result.status = 'supported';
    result.documentationOverride = {
        language: result.language, status: result.status, sdkFamily: result.sdkFamily,
        package: result.package, interoperability: result.interoperability, documentation: result.documentation,
        reviewedAt: '2026-09-11', rationale: 'Hypothetical documentation review fixture, not a claim of actual SDK support.',
    };
    report.overallStatus = 'supported';
    return report;
}

test('accepts explicit matching documentation override evidence without changing the offline matrix', () => {
    const report = reportWithOverride();
    assert.deepEqual(validateCompatibilityReport(report, ['Rust']).errors, []);
    assert.equal(validateCompatibilityReport(report, ['Rust']).codeMigrationAllowed, true);
    assert.equal(classifyLanguage('Rust').status, 'preview');
});

test('rejects missing, mismatched or invalid documentation override evidence', () => {
    for (const mutate of [
        result => { delete result.documentationOverride; },
        result => { result.documentationOverride = true; },
        result => { result.documentationOverride.language = 'Perl'; },
        result => { result.documentationOverride.package = 'different-package'; },
        result => { result.documentationOverride.status = 'unsupported'; },
        result => { result.documentationOverride.reviewedAt = '2026-02-30'; },
        result => { delete result.documentationOverride.rationale; },
        result => { result.documentationOverride.documentation = 'https://example.com/sdk'; },
        result => { result.documentation = result.documentationOverride.documentation = 'https://learn.microsoft.com.example.com/sdk'; },
        result => { result.documentation = result.documentationOverride.documentation = 'https://user:password@learn.microsoft.com/sdk'; },
    ]) {
        const report = reportWithOverride();
        mutate(report.results[0]);
        const result = validateCompatibilityReport(report, ['Rust']);
        assert(result.errors.length > 0);
        assert.equal(result.codeMigrationAllowed, false);
    }
});
