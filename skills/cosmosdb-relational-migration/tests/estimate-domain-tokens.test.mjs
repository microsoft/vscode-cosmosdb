import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_CHARACTERS_PER_TOKEN,
    estimateDomainWorkingSets,
    MAX_ESTIMATE_OUTPUT_BYTES,
    normalizeDomainMarkdown,
    summarizeDomainWorkingSets,
} from '../scripts/estimate-domain-tokens.mjs';

const scriptPath = fileURLToPath(new URL('../scripts/estimate-domain-tokens.mjs', import.meta.url));

test('budgets batched domain working sets against a known context window', () => {
    const result = estimateDomainWorkingSets({
        domains: [
            { name: 'Fits', markdown: '1234', inputs: [{ id: 'fits-input', content: '1234' }] },
            { name: 'Exceeds', markdown: '123456789012345678901234' },
        ],
        sharedInputs: [{ id: 'shared', content: '12345' }],
        charactersPerToken: 4,
        contextWindowTokens: 10,
        toolOutputBytes: 0,
    });
    assert.deepEqual(result, {
        estimator: 'character-heuristic',
        charactersPerToken: 4,
        contextWindowTokens: 10,
        outputReserveTokens: 2,
        safetyMarginTokens: 1,
        usableInputTokens: 7,
        sharedInputCount: 1,
        sharedTokens: 2,
        toolOutputBytes: 0,
        toolOutputTokens: 0,
        domains: [
            {
                name: 'Fits',
                domainTokens: 1,
                domainInputTokens: 1,
                estimatedInputTokens: 4,
                budgetStatus: 'fits',
                splitRequired: false,
            },
            {
                name: 'Exceeds',
                domainTokens: 6,
                domainInputTokens: 0,
                estimatedInputTokens: 8,
                budgetStatus: 'exceeds',
                splitRequired: true,
            },
        ],
    });
});

test('normalizes the persisted estimate heading before counting', () => {
    assert.equal(
        normalizeDomainMarkdown('# Domain: Orders\n\n## Estimated Tokens: 123,456\n'),
        '# Domain: Orders\n\n## Estimated Tokens: 0\n',
    );
});

test('does not claim fit or require splitting when the context window is unknown', () => {
    const result = estimateDomainWorkingSets({
        domains: [{ name: 'Orders', markdown: '1234' }],
        charactersPerToken: 4,
        toolOutputBytes: 0,
    });
    assert.equal(result.contextWindowTokens, null);
    assert.equal(result.usableInputTokens, null);
    assert.equal(result.domains[0].budgetStatus, 'unknown');
    assert.equal(result.domains[0].splitRequired, null);
});

test('deduplicates shared rules and excludes shared inputs from domain-specific totals', () => {
    const result = estimateDomainWorkingSets({
        domains: [{ name: 'Orders', markdown: '', inputs: [{ id: 'rule', content: '123456' }] }],
        sharedInputs: [{ id: 'skill', content: '123' }],
        ruleInputs: [
            { id: 'rule', content: '123456' },
            { id: 'skill', content: '123' },
        ],
        charactersPerToken: 3,
        toolOutputBytes: 0,
    });
    assert.equal(result.sharedInputCount, 2);
    assert.equal(result.sharedTokens, 3);
    assert.equal(result.domains[0].domainInputTokens, 0);
    assert.equal(result.domains[0].estimatedInputTokens, 3);
});

test('uses a conservative fallback and rejects invalid estimation policy', () => {
    assert.equal(DEFAULT_CHARACTERS_PER_TOKEN, 3);
    assert.throws(
        () => estimateDomainWorkingSets({ domains: [{ name: 'Orders', markdown: '' }], charactersPerToken: 0 }),
        /positive integer/u,
    );
    assert.throws(
        () => estimateDomainWorkingSets({
            domains: [{ name: 'Orders', markdown: '' }],
            sharedInputs: [{ id: 'same', content: 'first' }],
            ruleInputs: [{ id: 'same', content: 'second' }],
        }),
        /conflicting content/u,
    );
    assert.throws(
        () => estimateDomainWorkingSets({
            domains: [{ name: 'Orders', markdown: '' }],
            outputReserveTokens: 100,
        }),
        /require a known context window/u,
    );
});

test('paginates many domains within the output ceiling', () => {
    const report = estimateDomainWorkingSets({
        domains: Array.from({ length: 100 }, (_, index) => ({ name: `Domain${index}`, markdown: 'content' })),
        toolOutputBytes: 0,
    });
    const first = summarizeDomainWorkingSets(report, { limit: 10 });
    assert.equal(first.domainCount, 100);
    assert.equal(first.returnedDomains, 10);
    assert.equal(first.nextOffset, 10);
    assert.equal(first.unknownCount, 100);
    assert(Buffer.byteLength(`${JSON.stringify(first, null, 2)}\n`) <= MAX_ESTIMATE_OUTPUT_BYTES);
    const second = summarizeDomainWorkingSets(report, { offset: first.nextOffset, limit: 10 });
    assert.equal(second.domains[0].name, 'Domain10');
});

test('CLI estimates multiple domains and canonical-file inputs in one invocation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-working-set-'));
    try {
        const orders = path.join(root, 'orders.md');
        const catalog = path.join(root, 'catalog.md');
        const shared = path.join(root, 'shared.md');
        fs.writeFileSync(orders, 'orders');
        fs.writeFileSync(catalog, 'catalog');
        fs.writeFileSync(shared, 'shared');
        const result = spawnSync(
            process.execPath,
            [
                scriptPath,
                '--domain', `Orders=${orders}`,
                '--domain', `Catalog=${catalog}`,
                '--domain-input', `Orders=${shared}`,
                '--shared', shared,
                '--context-window', '1000',
                '--tool-output-bytes', '0',
            ],
            { encoding: 'utf8' },
        );
        assert.equal(result.status, 0, result.stderr);
        const report = JSON.parse(result.stdout);
        assert.deepEqual(report.domains.map(domain => domain.name), ['Orders', 'Catalog']);
        assert.equal(report.sharedInputCount, 1);
        assert.equal(report.domains[0].domainInputTokens, 0);
        assert(report.domains.every(domain => domain.budgetStatus === 'fits'));
    } finally {
        fs.rmSync(root, { recursive: true });
    }
});
