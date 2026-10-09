// Purpose: Define canonical migration phase names and normalize numeric aliases.

export const MIGRATION_PHASES = [
    'preflight',
    'discovery',
    'assessment',
    'schema-conversion',
    'provisioning',
    'code-migration',
];

const NUMERIC_PHASE_ALIASES = {
    '0': 'preflight',
    '1': 'discovery',
    '2': 'assessment',
    '3': 'schema-conversion',
    '4': 'provisioning',
};

export function normalizePhaseName(value) {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLocaleLowerCase('en-US');
    if (MIGRATION_PHASES.includes(normalized)) return normalized;
    return NUMERIC_PHASE_ALIASES[normalized];
}
