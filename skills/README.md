# Maintaining Skills

This folder contains skills shipped with the extension. Skills listed in [`package.json`](../package.json) under
`externalSkills` are maintained upstream and copied into this repository at a pinned commit. Skills not listed there are
maintained directly in this repository.

## External Skill Configuration

Each `externalSkills` entry defines:

| Field      | Purpose                                                                            |
| ---------- | ---------------------------------------------------------------------------------- |
| Entry name | Identifies the skill.                                                              |
| `repo`     | Upstream GitHub repository in `owner/repo` format.                                 |
| `path`     | Skill directory in the upstream repository and its destination in this repository. |
| `commit`   | Full upstream commit SHA to fetch. Use an immutable SHA, not a branch or tag.      |
| `exclude`  | Optional file-path suffixes to omit from the downloaded skill.                     |

Currently, `cosmosdb-best-practices` is imported from
[`AzureCosmosDB/cosmosdb-agent-kit`](https://github.com/AzureCosmosDB/cosmosdb-agent-kit).
The manifest is the source of truth for the pinned revision and exclusions.

## Updating an External Skill

1. For changes that belong upstream, contribute them there first and get them merged. For an upstream update that already
   exists, select the commit you want to import. Extension-only edits are also supported; see the cautions below.
2. Review the upstream changes, then set the skill's `commit` in [`package.json`](../package.json) to the full commit SHA.
3. From the repository root, refresh the configured external skills:

   ```bash
   npm run fetch-skill
   ```

4. Confirm the command reports a successful update for the skill, then review the manifest and downloaded changes:

   ```bash
   git diff -- package.json skills/
   git status --short
   ```

5. Run the repository checks:

   ```bash
   npm run prettier-fix
   npm run lint
   npm run build
   ```

6. Commit the pin change and refreshed skill files together.

Extension-only edits to an externally maintained skill are valid, but use them with caution. Keep them minimal and document
why they are needed. Fetching replaces the skill's entire local directory, including committed extension-only edits, so
preserve those changes before fetching and reapply and review them afterward. The command refreshes **all** configured
external skills, not just the changed pin. Intentional local differences can trigger CI drift warnings; review those warnings
to distinguish expected customizations from accidental drift.

To add another external skill, add its configuration to `externalSkills`, choose a full commit SHA, and follow the same
fetch, review, and validation steps. Review exclusions so that only the intended skill content is imported.

## Fetching and CI Verification

[`scripts/fetch-skill.mjs`](../scripts/fetch-skill.mjs) downloads all selected files for each skill before replacing that
skill's local directory. If GitHub rate limiting prevents a refresh, it preserves that skill's existing copy and emits a
warning. A rate-limited run can exit successfully without updating every skill; check the output and retry later.

The [build workflow](../.github/workflows/build.yml) fetches the pinned content and compares it with the committed skills,
ignoring line-ending, blank-line, and whitespace differences. Content drift produces a **warning**, not a blocking failure.
CI then restores the committed files, so the check does not update the skill content shipped by the build.
