# Relational to Azure Cosmos DB Migration

A portable agent skill for migrating relational applications to Azure Cosmos DB for
NoSQL. It supports source discovery, domain assessment, document-model design,
target provisioning with sample data, and application code migration.

This README is for people installing and using the skill. The agent's entry point
is [SKILL.md](./SKILL.md); its linked references define the workflow. You do not need
to repeat those procedures in your requests.

## Requirements

- An agent host with skill support and tools for reading, searching, editing files,
  and running commands. The workflow does not require VS Code or an MCP server.
- Node.js available to the host for the bundled helper scripts.
- The application workspace you want to migrate.
- The `cosmosdb-best-practices` peer skill, which supplies Cosmos DB design guidance.

SQLGlot is optional. Its setup helper requires Python 3.11 or later when that parser
is selected; model-only DDL interpretation does not require Python. See
[DDL interpretation](./references/workflow/ddl-interpretation.md) for the available
choices and dependency requirements.

Source analysis and model design do not require access to an Azure account. Applying
provisioning changes requires access to the intended target and explicit authorization.

## Installation

1. Install the entire `cosmosdb-relational-migration` folder through your host's
   supported skill installation or discovery mechanism. Keep its scripts, schemas,
   references, assets, and tests together; copying only [SKILL.md](./SKILL.md) is not enough.
2. Install `cosmosdb-best-practices` as a separate peer skill using the same mechanism.
3. Open the application workspace in your agent host and confirm both skills are available.

The installation should contain two independent skill folders:

```text
<host skill directory>/
|-- cosmosdb-relational-migration/
|   |-- README.md
|   |-- SKILL.md
|   |-- references/
|   |-- scripts/
|   |-- schemas/
|   |-- assets/
|   `-- tests/
`-- cosmosdb-best-practices/
    |-- SKILL.md
    `-- ...
```

## Get Started

In the application workspace, ask:

```text
Run a relational database migration to Azure Cosmos DB.
```

The default mode is interactive when the host can pause and receive your answers;
otherwise it is autonomous. You can explicitly choose a mode or limit the work to
a phase. The agent obtains the execution order and prerequisite handling from the
skill, not from the examples below.

### Run a Phase

```text
Run the preflight phase of a relational database migration to Azure Cosmos DB.
```

```text
Run the discovery phase of a relational database migration to Azure Cosmos DB.
```

```text
Run the assessment phase of a relational database migration to Azure Cosmos DB.
```

```text
Run the schema conversion phase of a relational database migration to Azure Cosmos DB.
```

### Regenerate Existing Results

When a phase already has results and you want to replace them:

```text
Regenerate the assessment results for a relational database migration to Azure Cosmos DB.
```

### Set the Scope or Parser

```text
Run a relational database migration to Azure Cosmos DB autonomously through schema conversion.
```

```text
Run a relational database migration to Azure Cosmos DB using model-only DDL interpretation.
```

### Provision or Change Application Code

```text
Run the provisioning phase of a relational database migration to Azure Cosmos DB.
Allow provisioning for this invocation.
```

```text
Create an application code migration plan for moving this relational application to Azure Cosmos DB.
```

```text
Update the application code migration plan for moving this relational application to Azure Cosmos DB.
```

```text
Migrate the application code using the validated migration plan.
```

Planning and applying application changes are separate requests. Resource and data
mutations require explicit permission for the current invocation; a previous run's
authorization does not carry forward.

## Inputs and Results

Start with the application source. You can also supply DDL, application details,
volumetric data, access-pattern descriptions, and relevant logs or query samples.
Existing DDL remains authoritative; the skill can infer schema from code when no DDL
is selected. The [volumetrics](./assets/volumetrics-template.md) and
[access-patterns](./assets/access-patterns-template.md) templates show the expected inputs.

The skill keeps checkpoints and generated artifacts under `.cosmosdb-migration/` in
the application workspace. Results include human-readable reports, a canonical
Cosmos DB model, deployment and sample-data artifacts, and an application migration
plan. Keep that directory with the workspace when continuing in another session or host.

| Phase | Main Result |
| --- | --- |
| [Preflight](./references/phases/preflight.md) | Prepared and validated migration inputs. |
| [Discovery](./references/phases/discovery.md) | Source schema and application access-pattern analysis. |
| [Assessment](./references/phases/assessment.md) | Domain assessments and cross-domain dependencies. |
| [Schema conversion](./references/phases/schema-conversion.md) | Validated Cosmos DB document model. |
| [Provisioning](./references/phases/provisioning.md) | Deployment artifacts and, when authorized, target resources and sample data. |
| [Code migration](./references/phases/code-migration.md) | An application change plan or explicitly requested implementation. |

Discovery can prepare missing preflight inputs as part of the same request; you do
not need to invoke each preparation step separately.

## Scope and Review

This is an agent-guided migration workflow, not a bulk production-data transfer or
cutover tool. Sample-data provisioning does not establish production-data completeness
or application correctness. Review the proposed model, costs, generated code, and
validation evidence before applying changes to a production environment.

Application code migration depends on the language's supported Cosmos DB SDK path.
See [SDK compatibility](./references/contracts/sdk-compatibility.md) for the current matrix.
Deterministic checks validate recorded structure and consistency; they do not prove
the agent's interpretation or replace behavioral application tests.

## Inspect and Test

To inspect a workspace without invoking an agent, replace the placeholders with your
installed skill directory and application workspace:

```bash
node <skill-root>/scripts/inspect-migration-state.mjs --workspace <workspace>
```

The inspector is read-only. For other commands and their side effects, see the
[helper command reference](./references/tooling/helper-commands.md). Each executable
helper supports `--help`.

Run the portable tests from this skill's directory:

```bash
node --test tests/*.test.mjs
```

The default suite does not require a live Cosmos DB target, paid model calls, or a
SQL parser installation. Real-agent evaluations and application behavior tests are
separate from these portable checks.
