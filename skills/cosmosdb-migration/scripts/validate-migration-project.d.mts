export function normalizeMigrationProjectCompatibility(value: unknown): { project: unknown; changes: string[] };
export function validateMigrationProject(project: unknown): { path: string; message: string }[];
