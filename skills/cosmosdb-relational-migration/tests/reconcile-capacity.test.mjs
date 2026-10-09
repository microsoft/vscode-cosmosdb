import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileCapacity } from '../scripts/reconcile-capacity.mjs';

const operation = (id, domain, rate, window = 'peak') => ({ id, domains: [domain], ruPerOperation: 1, operationsPerSecond: rate, window, source: 'access-patterns.md' });
const input = () => ({ operations: [operation('read-orders', 'Sales', 4000), operation('read-customers', 'Accounts', 4000)], storage: [
    { id: 'orders', kind: 'primary', rows: 100, bytesPerItem: 1000, source: 'volumetrics.md' },
    { id: 'lines', kind: 'embedded', parent: 'orders', rows: 200, bytesPerItem: 500, source: 'volumetrics.md' },
], sizing: { monthlyGrowthPercent: 0 } });

test('aggregates concurrent distinct demand without buffering the reconciled peak', () => {
    const result = reconcileCapacity(input(), ['Sales', 'Accounts'], 'provisioned');
    assert.equal(result.maxThroughput, 8000);
    assert.equal(result.estimatedRowCount, 100);
    assert.equal(result.estimatedStorageGB, 200000 / 1024 ** 3);
});

test('deduplicates declared shared operations and rejects contradictory estimates', () => {
    const evidence = input();
    evidence.operations[1] = operation('read-orders', 'Accounts', 4000);
    assert.equal(reconcileCapacity(evidence, ['Sales', 'Accounts'], 'provisioned').maxThroughput, 4000);
    evidence.operations[1].operationsPerSecond = 3000;
    assert.throws(() => reconcileCapacity(evidence, ['Sales', 'Accounts'], 'provisioned'), /Conflicting/);
});

test('handles separate windows, unknown storage and missing domain evidence', () => {
    const evidence = input();
    evidence.operations[1].window = 'night';
    evidence.storage[1].rows = null;
    const result = reconcileCapacity(evidence, ['Sales', 'Accounts'], 'provisioned');
    assert.equal(result.maxThroughput, 4000);
    assert.equal(result.estimatedStorageGB, undefined);
    assert.throws(() => reconcileCapacity(evidence, ['Sales', 'Accounts', 'Missing'], 'provisioned'), /omits/);
    assert.deepEqual(reconcileCapacity({ ...evidence, operations: [...evidence.operations].reverse() }, ['Sales', 'Accounts'], 'provisioned'), result);
});

test('keeps unknown growth non-blocking without inventing a storage projection', () => {
    for (const monthlyGrowthPercent of [undefined, null]) {
        const evidence = input();
        evidence.sizing = { monthlyGrowthPercent };
        const result = reconcileCapacity(evidence, ['Sales', 'Accounts'], 'provisioned');
        assert.equal(result.maxThroughput, 8000);
        assert.equal(result.estimatedRowCount, 100);
        assert.equal(result.estimatedStorageGB, undefined);
    }
    const evidence = input();
    evidence.sizing = { monthlyGrowthPercent: 0 };
    assert.equal(reconcileCapacity(evidence, ['Sales', 'Accounts'], 'provisioned').estimatedStorageGB, 200000 / 1024 ** 3);
});

test('caps retained storage without counting embedded rows as documents', () => {
    const evidence = input();
    evidence.sizing = { monthlyGrowthPercent: 10 };
    evidence.storage[0].retainedRows = 100;
    evidence.storage[1].retainedRows = 200;
    const result = reconcileCapacity(evidence, ['Sales', 'Accounts'], 'serverless');
    assert.equal(result.estimatedRowCount, 100);
    assert.equal(result.estimatedStorageGB, 200000 / 1024 ** 3);
});
