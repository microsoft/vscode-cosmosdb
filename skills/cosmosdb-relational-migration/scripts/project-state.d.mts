export function readProjectState(workspace: string): {
    projectPath: string;
    revision: string;
    project: unknown;
    compatibilityChanges?: string[];
};
export function updateProjectState(
    workspace: string,
    expectedRevision: string,
    update: (project: unknown) => unknown,
): { revision: string };
