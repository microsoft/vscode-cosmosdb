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
    mode: 'plan' | 'start' = 'start',
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

Reference concrete container names, partition keys, entities, and access patterns from the model.
Generate code snippets in the application's language and framework.

## Output
1. **Save the full migration plan** to \`${migrationFolder}/code-migration-plan.md\`.
2. **Print a comprehensive summary** of the plan (key steps, affected components, and notable decisions).
3. Include a link to the file: \`${migrationFolder}/code-migration-plan.md\`.
${mode === 'plan' ? '\n**IMPORTANT**: STOP after saving the plan file. Do NOT begin implementing any code changes.\n' : '\n**IMPORTANT**: After saving the plan file, IMMEDIATELY begin executing it — implement ALL code changes described in the plan. Do not wait for user confirmation.\n'}${instructionsSection}`;
}
