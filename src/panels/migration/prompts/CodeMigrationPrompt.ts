/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ProjectJson } from '../../../services/MigrationProjectService';
import { isDebugPromptsEnabled } from '../helpers/aiHelpers';

/**
 * Build a plain-text code migration prompt for Copilot Chat.
 * Advises the model to read model.json from disk instead of inlining it,
 * and to use Cosmos DB best practices without embedding them.
 */
export function buildCodeMigrationPrompt(
    project: ProjectJson | undefined,
    migrationFolder: string,
    action: 'plan' | 'migrate' = 'plan',
): string {
    const analysis = project?.phases.discovery.applicationAnalysis;
    const provisioning = project?.phases.provisioning;
    const targetEnv = project?.phases.targetEnvironment;

    // Source application context (only include truthy values)
    const appLines: string[] = [];
    if (analysis?.projectName) appLines.push(`- **Project**: ${analysis.projectName}`);
    if (analysis?.projectType) appLines.push(`- **Type**: ${analysis.projectType}`);
    if (analysis?.language) appLines.push(`- **Language**: ${analysis.language}`);
    if (analysis?.frameworks?.length) appLines.push(`- **Frameworks**: ${analysis.frameworks.join(', ')}`);
    if (analysis?.databaseType) appLines.push(`- **Source Database**: ${analysis.databaseType}`);
    if (analysis?.databaseAccess) appLines.push(`- **Database Access Method**: ${analysis.databaseAccess}`);
    const appSection = appLines.length > 0 ? `\n## Source Application\n${appLines.join('\n')}\n` : '';

    // Target environment context
    const envLines: string[] = [];
    if (provisioning?.databaseName) envLines.push(`- **Database**: ${provisioning.databaseName}`);
    if (provisioning?.containersCreated?.length)
        envLines.push(`- **Containers**: ${provisioning.containersCreated.join(', ')}`);
    if (targetEnv?.type) envLines.push(`- **Target**: ${targetEnv.type === 'azure' ? 'Azure' : 'Emulator'}`);
    const envSection = envLines.length > 0 ? `\n## Target Environment\n${envLines.join('\n')}\n` : '';

    // Debug prompts exclusion
    const debugExclusion = isDebugPromptsEnabled()
        ? `\n**IMPORTANT**: NEVER read or access any files inside \`debug-prompts\` folders within \`${migrationFolder}\`.\n`
        : '';

    // Additional migration instructions
    const instructionsSection = project?.migrationInstructions
        ? `\n## Additional Migration Instructions (from the user)\n\n${project.migrationInstructions}\n`
        : '';

    return `You are an expert Azure Cosmos DB NoSQL architect helping migrate an application from a relational database.
Generate a detailed, step-by-step CODE MIGRATION PLAN to refactor the data access layer to use the Azure Cosmos DB NoSQL.
Focus on APPLICATION CODE CHANGES — this is NOT a data migration plan.
${debugExclusion}
## Instructions
0. **Artifact regeneration: required.** Execute this code-migration action even if the existing checkpoint and plan validate. Rebuild the phase-owned outputs as though they were absent; do not ask whether to validate instead and do not stop based on existing outputs.
1. **Read the Cosmos DB data model** at \`${migrationFolder}/phases/3-schema-conversion/model.json\`
   — this is the highest-priority migration artifact defining the target schema.
   - Read and analyze it thoroughly before generating the plan.
   - Also read \`${migrationFolder}/phases/3-schema-conversion/summary.md\` for a deeper understanding of the schema design decisions and recommendations.
2. **Understand domain access patterns** by reading \`${migrationFolder}/phases/2-assessment/domains/*.md\` — these summaries describe the access patterns for each domain.
3. **Scan the entire workspace** (excluding the \`${migrationFolder}\` folder!) to understand the application structure, dependencies, and data access patterns before planning. **Prioritize files matching the source application's language${analysis?.frameworks?.length ? ' and frameworks' : ''}** — other files should be reviewed with lower priority.
5. Follow **Azure Cosmos DB best practices** from the \`/cosmosdb-best-practices\` skill for data modeling, partitioning, and SDK usage.
6. If anything is ambiguous, missing, or contradictory, **first look for answers** in these additional files before asking the user:
    - \`${migrationFolder}/phases/1-discovery/discovery-report.md\` — original schema and access patterns to be migrated from.
    - \`${migrationFolder}/phases/2-assessment/assessment-summary.md\` — domain breakdown, dependencies, and their access patterns in the original code.
   - After consulting those files, **always ask clarifying questions** about anything that remains unclear rather than making assumptions.
7. **Review execution blockers during planning**. Investigate each candidate using repository evidence, migration artifacts, and applicable best practices, then propose a concrete solution. Treat known framework upgrades, SDK/package changes, and configuration work as ordered changes when a compatible solution can be planned.
8. In interactive planning, ask the user now about consequential choices with multiple valid solutions. For every recommendation, add a recommendation rationale that cites evidence and constraints, compares the material alternatives, and explains why its tradeoffs best fit this migration. A "Recommended" label alone is not a rationale. Defer only blockers that cannot be resolved during planning. For each deferred blocker, record a stable identifier, evidence, solutions considered, recommendation, recommendation rationale, reason for deferral, and exact clearance condition.
${appSection}${envSection}
## Migration Plan Requirements

**Framework-first approach**: If the application's current framework has built-in Cosmos DB support (e.g., Entity Framework Core with the Cosmos provider for .NET), **prefer using that framework's Cosmos DB capabilities** over the raw Cosmos DB SDK. Only fall back to the Cosmos DB SDK directly for operations the framework does not support or where the SDK provides a clear advantage (e.g., bulk operations, change feed, cross-partition queries).

Your plan MUST cover:
1. **SDK / Driver Setup** — Based on the application's framework, configure the appropriate Cosmos DB integration. If the framework supports Cosmos DB natively (e.g., EF Core Cosmos provider), configure it as the primary data access method. Install the Cosmos DB SDK only for operations the framework cannot handle.
2. **Repository / Data Access Layer** — For each container in the model, create or refactor the data access methods. Map each entity's document type (\`docType\`) and attributes to the new schema.
3. **Partition Key Usage** — Show how to use the partition key paths defined in the model when reading and writing documents.
4. **Embedded vs. Referenced Relationships** — For relationships marked \`embed\`, show how to write denormalized documents. For \`reference\` relationships, show lookup patterns.
5. **Access Pattern Migration** — For each access pattern mapping in the model, show the equivalent Cosmos DB query or point-read replacing the original SQL query.
6. **Cross-Partition Query Handling** — For any cross-partition queries listed, apply the recommended optimizations.
7. **Connection & Configuration** — Show how to configure the connection string / endpoint for both the emulator and Azure.

Use these exact non-empty level-two Markdown headings: "Overview", "Affected Files",
"Ordered Changes", "Access Pattern Migration", "Configuration and Authentication",
"Validation", "Rollback", "Applied Rules", "Blocker Review", and "Unresolved Blockers".

Under "Blocker Review", inventory every candidate as resolved or deferred. Include
only deferred items under "Unresolved Blockers" and blockingSteps, using the same
stable identifier and text in all three locations. Every candidate recommendation
must include a "Recommendation rationale:" that explains why it is preferable to the
material alternatives. If there are no candidates, write exactly "No candidate blockers."

Write \`${migrationFolder}/code-migration-manifest.json\` as a JSON object with:
- version 1 and mode "${action}".
- modelSha256 and sdkReportSha256 computed from the exact bytes of model.json and
    the discovery manifest.
- bestPractices with unique model-selected rule paths and unresolvedConcerns. Also
    list every rule path in the human-readable "Applied Rules" section. Migrate mode
    requires unresolvedConcerns to be empty.
- outputFiles: empty in plan mode; in migrate mode, each changed workspace-relative
    application path and the lowercase SHA-256 hash of its final bytes.
- blockingSteps: explicit unresolved blockers; this must be empty in migrate mode.
- validation: actual commands, coverage, and results. Each entry has a non-empty
    checks array of unique categories ("build", "behavior", or "other") and a
    non-empty coverage description. A passed result also has command, status
    "passed", and exitCode 0, without reason. A genuinely non-applicable check has
    status "not-applicable" and a reason, without command or exitCode. Account for
    both build and behavior in migrate mode; one combined command may cover both.
    In plan mode, describe planned checks in the summary and leave validation empty
    until checks actually run.

Never put output files under "${migrationFolder}". In migrate mode, run applicable
repository build/type-check targets and focused behavioral tests selected from the
repository's scripts, CI, and migrated access patterns. Record actual exit codes,
coverage, meaningful limitations, and any omissions in the Validation summary.
Distinguish unit/mocked checks from SDK and live-target checks. Cover affected identity,
partition routing, serialization, queries, relationships, and concurrency where relevant.
A missing test harness, unavailable target, failed check, or timeout is not a reason to
declare an applicable check not-applicable: leave the iteration incomplete, record a
blocker and its clearance condition, and do not fabricate evidence. Syntax checks, lint,
and arbitrary successful commands are not proof of application behavior.
The validator checks record consistency, not command names, execution, or test quality;
the host owns truthful execution and coverage review. Read
"${migrationFolder}/phases/1-discovery/discovery-manifest.json" and use its
sdkCompatibility field; if code migration is
not allowed, retain that as a plan-mode blocker and do not edit application code.

Reference concrete container names, partition keys, entities, and access patterns from the model.
Generate code snippets in the application's language and framework.

After validating the plan and any migrate-mode outputs, update project.json with
phases.codeMigration status, planPath, completedAt, and outputPaths. Preserve any
root migrationMode value unchanged; it does not determine the requested action.
Use exactly ".cosmosdb-migration/code-migration-plan.md" for planPath and a UTC ISO
8601 completedAt value. Reject duplicate output paths and paths that escape the
workspace after resolving symlinks.

## Output
1. **Save the full migration plan** to \`${migrationFolder}/code-migration-plan.md\` and its machine-readable evidence to \`${migrationFolder}/code-migration-manifest.json\`.
2. **Print a comprehensive summary** of the plan (key steps, affected components, and notable decisions).
3. Include a link to the file: \`${migrationFolder}/code-migration-plan.md\`.
${action === 'plan' ? '\n**IMPORTANT**: STOP after saving the plan file. Do NOT begin implementing any code changes.\n' : '\n**IMPORTANT**: MIGRATE the application after saving the plan — implement all validated code changes described in the plan.\n'}${instructionsSection}`;
}
