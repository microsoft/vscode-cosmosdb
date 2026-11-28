// Purpose: Preserve typed partition-key values in JSON evidence, including null versus missing.

const MAX_PARTITION_KEY_BYTES = 2048;
const missing = Object.freeze({ state: 'missing' });

export function isPartitionKeyValue(value) {
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') <= MAX_PARTITION_KEY_BYTES;
    return value !== undefined && typeof value === 'object' && !Array.isArray(value) &&
        Object.hasOwn(value, 'state') && value.state === 'missing' && Object.keys(value).length === 1;
}

export function readPartitionKeyValue(item, partitionPath) {
    const property = partitionPath.slice(1);
    if (!Object.hasOwn(item, property)) return missing;
    const value = item[property];
    if (typeof value === 'string') {
        const byteLength = Buffer.byteLength(value, 'utf8');
        if (byteLength > MAX_PARTITION_KEY_BYTES) {
            throw new Error(`exceeds the ${MAX_PARTITION_KEY_BYTES}-byte partition-key limit (${byteLength} UTF-8 bytes)`);
        }
    }
    if ((value !== null && typeof value === 'object') || !isPartitionKeyValue(value)) {
        throw new Error(`partition key ${partitionPath} must be a string, finite number, boolean, null, or missing`);
    }
    return value;
}
