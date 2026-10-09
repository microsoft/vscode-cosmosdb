// Purpose: Reconcile shared-container workload and storage evidence into capacity estimates.

import { calculateCapacity } from './calculate-capacity.mjs';

function number(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative finite number`);
    return value;
}

function text(value, field) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
    return value;
}

export function reconcileCapacity(evidence, domains, capacityMode) {
    if (!evidence || !Array.isArray(evidence.operations) || !Array.isArray(evidence.storage)) throw new Error('Shared container requires operation and storage contribution evidence');
    const covered = new Set();
    const contributions = new Map();
    for (const operation of evidence.operations) {
        text(operation.id, 'operation id');
        text(operation.window, 'observation window');
        text(operation.source, 'operation provenance');
        if (!Array.isArray(operation.domains) || !operation.domains.length || operation.domains.some(domain => !domains.includes(domain))) throw new Error('Operation domains must identify contributing selected domains');
        operation.domains.forEach(domain => covered.add(domain));
        const key = JSON.stringify([operation.id, operation.window]);
        const value = { ruPerOperation: number(operation.ruPerOperation, 'RU per operation'), operationsPerSecond: number(operation.operationsPerSecond, 'operations per second'), window: operation.window };
        if (contributions.has(key) && JSON.stringify(contributions.get(key)) !== JSON.stringify(value)) throw new Error(`Conflicting estimates for operation ${operation.id}`);
        contributions.set(key, value);
    }
    if (domains.some(domain => !covered.has(domain))) throw new Error('Capacity evidence omits a contributing domain');
    const windows = new Map();
    for (const [, operation] of [...contributions].sort(([left], [right]) => left.localeCompare(right))) {
        windows.set(operation.window, (windows.get(operation.window) ?? 0) + operation.ruPerOperation * operation.operationsPerSecond);
    }
    const peak = Math.max(0, ...windows.values());
    const result = {};
    if (capacityMode === 'provisioned') {
        if (!peak) throw new Error('Provisioned capacity needs a positive measured or explicitly estimated demand');
        result.maxThroughput = calculateCapacity({
            ...evidence.sizing,
            monthlyGrowthPercent: evidence.sizing?.monthlyGrowthPercent ?? undefined,
            estimatedPeakRuPerSecond: peak,
        }).recommendedAutoscaleMaxRuPerSecond;
    }
    const storage = new Map();
    for (const contribution of evidence.storage) {
        text(contribution.id, 'storage identity');
        text(contribution.source, 'storage provenance');
        if (!['primary', 'embedded', 'projection'].includes(contribution.kind)) throw new Error('Unknown storage contribution kind');
        const value = { kind: contribution.kind, parent: contribution.parent ?? null,
            rows: contribution.rows === null ? null : number(contribution.rows, 'rows'),
            bytesPerItem: contribution.bytesPerItem === null ? null : number(contribution.bytesPerItem, 'bytes per item'),
            retainedRows: contribution.retainedRows === undefined ? undefined : number(contribution.retainedRows, 'retention row cap') };
        if (value.rows !== null && !Number.isInteger(value.rows)) throw new Error('Row count must be an integer');
        if (storage.has(contribution.id) && JSON.stringify(storage.get(contribution.id)) !== JSON.stringify(value)) throw new Error(`Conflicting storage estimates for ${contribution.id}`);
        storage.set(contribution.id, value);
    }
    for (const value of storage.values()) {
        if (value.kind === 'embedded' && (!storage.has(value.parent) || storage.get(value.parent).kind === 'embedded')) throw new Error('Embedded storage must name its standalone parent contribution');
    }
    const orderedStorage = [...storage].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
    if (storage.size && orderedStorage.every(value => value.rows !== null)) {
        result.estimatedRowCount = orderedStorage.filter(value => value.kind !== 'embedded').reduce((total, value) => total + value.rows, 0);
        const growthInput = evidence.sizing?.monthlyGrowthPercent;
        if (orderedStorage.every(value => value.bytesPerItem !== null) && growthInput !== undefined && growthInput !== null) {
            const growth = number(growthInput, 'monthly growth');
            result.estimatedStorageGB = orderedStorage.reduce((total, value) => total + Math.min(value.rows * (1 + growth / 100) ** 12, value.retainedRows ?? Infinity) * value.bytesPerItem, 0) / 1024 ** 3;
        }
    }
    if (Object.values(result).some(value => !Number.isFinite(value))) throw new Error('Capacity arithmetic overflow');
    return result;
}
