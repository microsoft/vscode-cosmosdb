/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type BasePromptElementProps,
    PromptElement,
    type PromptPiece,
    type PromptSizing,
    TextChunk,
    UserMessage,
} from '@vscode/prompt-tsx';

declare const vscpp: (ctor: unknown, props: unknown, ...children: unknown[]) => PromptPiece;
declare const vscppf: { isFragment: boolean };

interface Phase3Step8FinalSummaryPromptProps extends BasePromptElementProps {
    mergedModel: string;
    conflicts: string;
    domainSummaries: string;
    crossDomainStrategies: string;
    bestPractices: string;
    outputRelativePath: string;
    schemaConversionInstructions: string;
    /**
     * Content of `volumetrics.md` from Phase 1 discovery, when present.
     * Used to ground the cross-domain capacity summary (total storage, total
     * RU/s, serverless ceiling checks) in real discovery inputs.
     */
    volumetricsMd?: string;
}

/**
 * Final step of Phase 3: Cross-Domain Merge & Deployment Model.
 * Takes the programmatically merged model from all domains, resolves conflicts
 * (e.g. duplicate container names with differing partition keys), and produces
 * a deployment-ready model.json plus a cross-domain summary.
 *
 * TODO Step 2:
TODO: allow collapsing domains, needs actual code references
TEST: advise it to treat everything as one single domain
 */
export class Phase3Step8FinalSummaryPrompt extends PromptElement<Phase3Step8FinalSummaryPromptProps> {
    render(_state: void, _sizing: PromptSizing): PromptPiece {
        return vscpp(
            vscppf,
            null,
            vscpp(
                UserMessage,
                { priority: 200 },
                vscpp(
                    TextChunk,
                    null,
                    `You are an expert Azure Cosmos DB NoSQL architect. You are given a merged data model
that combines all per-domain schema conversion results into a single model. Your task is to
validate the merged model, resolve any conflicts, and produce a deployment-ready model along
with a comprehensive cross-domain summary.

## Instructions

### 1. Resolve Conflicts

The programmatic merge may have detected conflicts when containers from different domains
share the same name. For each conflict listed below, decide:
- Which partition key configuration should win (or whether they should be reconciled)
- How to merge indexing policies (union paths, resolve conflicting modes)
- Whether duplicate entities should be deduplicated or renamed
- Provide a clear rationale for each resolution

If there are NO conflicts, simply confirm the merged model is valid.

### 2. Validate Cross-Domain References

Using the cross-domain strategies from the assessment phase, verify that:
- Denormalization decisions are reflected in the model (duplicated attributes exist)
- Reference document patterns have the necessary ID attributes
- Any Change Feed or materialized view patterns are noted in the summary

### 3. Suggest a Database Name

Propose a concise, descriptive Cosmos DB database name and store it in the top-level
\`databaseName\` field of the model. The name must:
- Be grounded in the original source database name and the final containers schema
  (e.g. reflect the domain, purpose, or key entities in the migrated model)
- Follow Cosmos DB naming rules: 3-63 characters, lowercase letters, digits, and hyphens
  only, must start with a lowercase letter or digit
- Be clear and recognizable to someone familiar with the source system

Always set \`databaseName\` — this counts as a model modification, so set
\`modelModified\` to \`true\` and include the full model in \`updatedModel\`.

### 4. Produce the Final Model

Output the full deployment-ready CosmosModel JSON.
The model must:
- Include the \`databaseName\` field from step 3
- Include a \`capacityMode\` field set to either \`"serverless"\` or \`"provisioned"\`
  based on your throughput recommendation from the Deployment Notes analysis
- Contain ALL containers across all domains with conflicts resolved
- Preserve all partition key configurations, indexing policies, entities, and relationships
- Do NOT include partition key candidates, scores, or analysis text in the model JSON — each partitionKeys entry should contain only the final "path"
- Preserve the \`isEmbeddedOnly\` flag on entities that are fully embedded within another entity
- Use domain: "all" to indicate this is the unified model
- Be structurally valid and ready to be consumed by a provisioning script
- For provisioned mode: include a \`maxThroughput\` field (autoscale maximum RU/s) on each
  container. Reconcile per-domain throughput recommendations when multiple domains share a
  container (sum their estimates). For serverless mode: omit \`maxThroughput\` from containers.

### 5. Generate Cross-Domain Summary

Write a comprehensive markdown summary covering:

1. **Database Overview** — Suggested database name, total containers, total entities,
   source database type. State the suggested \`databaseName\` prominently.
   Count containers and entities directly from the model JSON provided. Do not estimate.
2. **Container Inventory** — Table listing each container, its domain origin, entity count,
   partition key, and docType strategy
   - sort containers by domain, then by name
3. **Container Mappings** — For each container, list the source tables it maps from across all domains.
   If a container contains entities from multiple source tables, list them all.
   This shows how the original relational schema maps to the final containers.
4. **Cross-Domain Relationships** — How cross-domain foreign keys are handled
   (denormalization, references, Change Feed, etc.)
5. **Conflict Resolutions** — If any conflicts were resolved, explain each decision
6. **Deployment Notes** — Prerequisites and considerations for provisioning:
   - **Account throughput mode**: Choose **Serverless** or **Provisioned (autoscale)** for
     the whole account; justify against total volume, request patterns, and predictability.
   - **Per-container throughput**: For provisioned mode the per-container \`maxThroughput\`
     in the model JSON IS the recommendation (no need to restate elsewhere). For
     serverless, note expected RU consumption characteristics per container.
   - **Capacity Summary** table: \`Container | Domain | Recommended max RU/s | 12-mo storage (GB) | Inputs\`.
     Pull \`maxThroughput\` and \`estimatedStorageGB\` directly from the merged model JSON;
     mark missing cells \`n/a\` and tag Inputs \`[default assumed]\`. Below the table, list:
     **Total RU/s**, **Total 12-mo storage (GB)**, **Container count**.
   - **Serverless ceiling checks** (only if mode = Serverless): flag any container above
     **5,000 RU/s** or **1 TB** as NOT serverless-eligible and recommend Provisioned for it
     (or the whole account).
   - Do NOT add an "Estimate Disclaimer" section — a fixed one is appended automatically.
   - Indexing policy highlights
7. **Per-Domain References** — Links to each domain's detailed summary using relative paths.
   Domain summaries live in \`domains/<DomainName>/summary.md\` relative to this summary.

This summary will be saved at \`${this.props.outputRelativePath}\` relative to the workspace root.
Use ONLY relative links — never absolute paths.

## Output Format

Respond with a JSON object in EXACTLY this format (no markdown, no code fences).

{
  "analysis": "## Cross-Domain Schema Conversion Summary\\n\\n...",
  "updatedModel": { <full deployment-ready CosmosModel JSON with databaseName and capacityMode> },
  "modelModified": true
}

IMPORTANT: Your FINAL response must be ONLY the JSON object. Because you must always set
\`databaseName\`, the model is always modified — always include the full model.`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(TextChunk, { priority: 95 }, '\n\n# Merged Model (all domains combined)\n\n'),
                vscpp(TextChunk, { priority: 90 }, this.props.mergedModel),
                vscpp(TextChunk, { priority: 85 }, '\n\n# Merge Conflicts\n\n'),
                vscpp(TextChunk, { priority: 80, breakOn: /\s+/g }, this.props.conflicts || 'No conflicts detected.'),
                vscpp(TextChunk, { priority: 75 }, '\n\n# Per-Domain Summaries\n\n'),
                vscpp(TextChunk, { priority: 70, breakOn: /\s+/g }, this.props.domainSummaries || '(not available)'),
                vscpp(TextChunk, { priority: 65 }, '\n\n# Cross-Domain Dependency Strategies (from Assessment)\n\n'),
                vscpp(
                    TextChunk,
                    { priority: 60, breakOn: /\s+/g },
                    this.props.crossDomainStrategies || '(none detected)',
                ),
                vscpp(
                    TextChunk,
                    { priority: 58 },
                    '\n\n# Volumetrics (from discovery)\n\n' +
                        (this.props.volumetricsMd && this.props.volumetricsMd.trim().length > 0
                            ? 'PRIMARY source of magnitudes for the Capacity Summary and serverless ceiling checks. Workload Notes (bottom) override code-inferred values when explicit.\n\n'
                            : 'No `volumetrics.md` was provided. Mark missing numeric cells `n/a` and tag Inputs `[default assumed]`.\n\n'),
                ),
                vscpp(
                    TextChunk,
                    { priority: 58, breakOnWhitespace: false },
                    this.props.volumetricsMd && this.props.volumetricsMd.trim().length > 0
                        ? this.props.volumetricsMd
                        : '',
                ),
                vscpp(
                    TextChunk,
                    { priority: 57 },
                    this.props.schemaConversionInstructions
                        ? '\n\n# ADDITIONAL SCHEMA CONVERSION INSTRUCTIONS (from the user)\n\n' +
                              this.props.schemaConversionInstructions +
                              '\n\n'
                        : '',
                ),
                vscpp(TextChunk, { priority: 55 }, '\n\n# Cosmos DB Best Practices Skill\n\n'),
                vscpp(TextChunk, { priority: 50, breakOn: /\s+/g }, this.props.bestPractices),
                vscpp(
                    TextChunk,
                    { priority: 45 },
                    '\n\nFor detailed guidance on any rule listed above, use the `loadSkillSupplementaryFile` tool with skillPath `skills/cosmosdb-best-practices/SKILL.md` and the relative path from the overview (e.g. `rules/partition-high-cardinality.md`).\n',
                ),
            ),
        );
    }
}
