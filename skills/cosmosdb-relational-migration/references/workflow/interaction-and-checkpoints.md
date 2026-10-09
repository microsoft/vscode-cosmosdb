# Interaction and Phase Checkpoints

Apply this contract to every named phase from `preflight` through `code-migration`.

For mutating invocations, report `execution` activity using
[Run Activity](../contracts/project-state-and-artifacts.md#run-activity). Record `waiting-for-decision` before asking
for in-run input and `running` after the answer. A terminal blocker ends activity as `blocked`; a user-requested stop
ends it as `cancelled`. Complete activity only after the requested scope validates and its final checkpoint is saved.
This does not change the existing phase-status enum or authorize resource mutations.

## Modes

### Interactive

Interactive mode is available only when the host can pause execution, present choices,
and receive the user's answer in the same run. It is the default when the user does
not specify a mode and the host supports those capabilities. Otherwise use autonomous
mode. If the user explicitly requests interactive mode on an incapable host, report
the fallback and continue autonomously; do not emit a question that the host cannot
answer. Treat unknown host interaction capability as unsupported.

- Pause after every completed phase, including standalone `preflight`. When preflight
  is preparation within a Discovery request, report its checkpoint and continue into
  source discovery without asking for a separate launch or routine continue confirmation.
- Present the phase checkpoint before starting the next phase.
- Ask the user to continue, review artifacts, revise the completed phase, or stop.
- Ask for confirmation whenever a discrepancy or consequential design choice has
  multiple reasonable resolutions.
- During code-migration planning, review candidate execution blockers, propose
  solutions, and ask consequential resolution questions before completing the plan.
  Defer only items that cannot be resolved during planning.
- Never treat silence as approval.
- Before first external DDL parser use, ask the dependency question with the SQLGlot
  link and model-only alternative in [DDL interpretation](./ddl-interpretation.md).
  Preserve the answer across resume; a saved unattended default is not consent.

When the requested phase is already complete and the request does not explicitly say
`regenerate` or `validate`, ask:

1. Regenerate all phase-owned output artifacts. (Recommended when rerunning.)
2. Validate existing artifacts without regenerating them.
3. Review existing artifacts before deciding.
4. Stop.

If the request explicitly says regenerate or validate, execute that intent without
asking again.

### Autonomous

Autonomous mode is the default when the host cannot pause and receive user answers.
Do not attempt interactive prompts in such a host.

- Do not pause at routine phase boundaries.
- Default to SQLGlot for DDL unless the current or saved request opts out. Announce
  the external dependency and link, persist the choice, and honor host installation
  permissions. An unsupported dialect or unavailable unattended default warns and
  continues with model interpretation without parser scripts. An unavailable explicit
  SQLGlot selection aborts after any permitted installation attempt fails.
- When rerunning any completed phase, always regenerate its phase-owned output
  artifacts as though they were absent. Do not stop after successful validation of
  existing outputs.
- Emit the same checkpoint summary to the run log or conversation, then continue.
- Resolve only choices that are deterministic, reversible, non-destructive, and
  already governed by an explicit invariant.
- Stop and request confirmation for choices that change authoritative input,
  discard user work, alter `schema-conversion` ownership or partitioning, materially
  change cost/security/availability, or trigger external side effects without prior
  authorization.
- In a non-interactive host, persist the completed checkpoint, report the pending
  decision with options, and exit cleanly so another invocation can resume.

An optional `phase` scope limits either mode to one phase. The run always stops
after that phase's checkpoint, even in autonomous mode. Discovery includes required
preflight preparation in scope; its final checkpoint is Discovery, not preflight.

## Discovering Decisions

Continuously compare authoritative inputs, other evidence, generated artifacts,
validation results, and best-practice guidance. Create a decision candidate when:

- Two evidence sources materially disagree.
- An engineer-authored value conflicts with code or generated analysis.
- More than one valid Cosmos DB design has a meaningful tradeoff.
- A warning changes cost, performance, consistency, availability, security, or
  application architecture.
- Proceeding would overwrite, exclude, merge, rename, or discard user work.
- Required information is missing and assumptions would materially affect output.
- SDK compatibility is preview or unsupported and code migration is requested.
- Provisioning or another external side effect needs authorization.

Do not ask about cosmetic choices or decisions fixed by a hard invariant. For
example, supplied DDL remains authoritative; ask whether to continue with a warning
or stop for correction, not whether to silently rewrite it from code.

On resume or regeneration, reassess retained decisions and blockers against current
scope and evidence. Preserve applicable requirements and explicit restrictions;
retire obsolete assumptions and reopen materially changed choices. A prior request
to stop ends only that invocation; it does not permanently reject an option. Record changed
dispositions and their rationale in the existing phase summary.

## Decision Prompt

Present a small number of related decisions at a time.

Keep independently resolvable concerns in separate questions. Do not bundle missing
evidence, architecture approval, and a change of guarantees into one contract choice.
Ask for the next specific evidence or design decision, not permission to begin
design work already in scope. When evidence is unavailable, keep that choice open
and continue independent work; offer deferral of the affected choice where useful,
without treating deferral as approval or completed validation.

For each decision include:

1. Stable short identifier and severity: `blocking`, `warning`, or `advisory`.
2. The discrepancy or choice in one sentence.
3. Concise evidence with source artifact paths.
4. Impact on later phases or generated outputs.
5. Two to four concrete options, each with consequences.
6. A recommended option only when evidence supports one.
7. A `Recommendation rationale` immediately after the options. In one to three
  sentences, cite the relevant evidence and constraints, compare the recommended
  option with the material alternatives, and explain why its tradeoffs best fit this
  migration. Never use only labels such as `Recommended`, `best practice`, or
  `preferred` as the explanation.
8. An open-ended `Other` option when the host supports free-form input.

Example:

```text
DDL-001 (warning): Orders.Status exists in code but not in supplied DDL.
Evidence: db/schema.sql; src/Order.cs
Impact: The field will not be included in the authoritative source model.

Options:
1. Continue using supplied DDL and retain this warning. (Recommended)
2. Stop so I can update or replace the supplied DDL.
3. Exclude the affected application area from this migration.
4. Other.

Recommendation rationale: Option 1 preserves the supplied DDL as the authoritative
schema while retaining a visible discrepancy for code migration. Option 2 delays all
downstream work, and option 3 drops application scope without evidence that the field
is irrelevant.
```

Record the selected option and rationale in the current phase summary. Do not add
new fields to `project.json` for decision history. The defined
`phases.discovery.ddlParsing` field stores the current parsing choice, not a history.
Keep one result per phase and one summary per domain, apart from the approved
canonical root model and executable provisioning inputs. Explain and obtain approval
before creating another durable artifact; an unattended run records the pending need
in the existing summary and stops rather than creating the extra file.

## Phase Checkpoint

After every requested task and at each phase boundary, provide a short, comprehensive
user-facing summary. This includes focused preflight/provisioning steps, validation-only
requests, regeneration, artifact reviews, and blocked or interrupted work, not only
successful phase completion. For focused work, distinguish the task's outcome from the
whole phase's completion; finishing one step does not certify the remaining gates.
Acknowledge a decision answer with its effect on the work;
do not repeat the full checkpoint after every tool call or intermediate question.

Aim for roughly 100-200 words when the result warrants it; simpler tasks need less.
Lead with the outcome and scope, then two to five substantive findings and their
migration implications. Counts, files written, and checks passed are supporting facts,
not a substitute for explaining what was learned or decided. Summarize the material
warnings, confirmed decisions, remaining blockers, and next action without reproducing
the full report. Omit empty sections and combine related points to keep the reply short.
Keep validation assurance explicit: structural checks do not establish source-engine,
production-workload, live-target, or application-behavior correctness.

Use the following content as a checklist, adapting its presentation to the task:

```text
<phase-name> — <complete | blocked | complete with warnings>

Summary:
<Two to five concise bullets describing key findings, decisions, and migration implications.>

Details:
- [<report label>](<workspace-relative report path>)

Generated or updated artifacts:
- <workspace-relative path> — <created | updated | preserved> — <purpose>

Discrepancies and warnings:
- <identifier and short description, or "None">

Decisions:
- <confirmed decision and selected option, pending decision, or "None">

Validation:
- <checks run and result>

Next:
<next action, pending decision, or requested stopping point>
```

List only artifacts that exist, using workspace-relative paths. Distinguish files
created, updated, and deliberately preserved. Include `project.json` when the phase
changed it.

Provide clickable Markdown links to the applicable in-depth summary or report in the
actual reply, not bare paths, inline-code filenames, or a fenced block containing links.
Verify each target exists and use paths relative to the application workspace, not the
Skill installation. Use the host's supported file-link syntax when ordinary relative
Markdown links are unavailable. Link the human-readable report first; a JSON manifest
is supporting evidence, not its replacement. If no report exists yet, say so instead
of inventing a link or creating an extra artifact solely for the reply.

| Result | Primary Detail Link |
| --- | --- |
| Preflight or a focused preflight step | `.cosmosdb-migration/phases/1-discovery/preflight-summary.md` |
| Discovery | `.cosmosdb-migration/phases/1-discovery/discovery-report.md`; also link the preflight summary when preparation ran. |
| Assessment | `.cosmosdb-migration/phases/2-assessment/assessment-summary.md`; add relevant domain summaries for domain-scoped findings. |
| Schema conversion | `.cosmosdb-migration/phases/3-schema-conversion/summary.md`; add relevant converted-domain summaries when applicable. |
| Provisioning or a focused provisioning step | `.cosmosdb-migration/phases/4-provisioning/summary.md` |
| Code-migration planning or execution | `.cosmosdb-migration/code-migration-plan.md`; add existing implementation or validation artifacts relevant to the result. |

For Discovery, prioritize the source stack and observed application coverage, important
access or relational-semantic findings, retained scope decisions, and the most consequential
evidence gaps. For example, explain how unbounded reads, concurrency behavior, runtime
compatibility, or unknown workload measurements affect later work when the report supports
those findings. Do not invent findings to fill a fixed template.

Before reporting `complete`, run the phase-completion checker. Report `artifactCounts`
and list the returned required missing or invalid outputs. Do not expand present
artifacts into full contents or exhaustive inventories unless the user asks to review
them; this does not remove the requirement to summarize findings and link the report. Follow
`nextOffset` only when the remaining failures are needed to act or report accurately;
use `--artifact` for one failing path rather than loading unrelated diagnostics. A
project status of `complete` with a missing or invalid required artifact is reported
as `blocked`, never `complete with warnings`.

When important artifacts are missing in interactive mode, ask:

1. Rerun the phase and regenerate required artifacts. (Recommended for generated output.)
2. Stop so I can repair or restore the artifacts manually.
3. Review the artifacts that remain before deciding.
4. Other.

## Interactive Continue Prompt

After the checkpoint and any required decision prompts, ask:

1. Continue to the next phase.
2. Review generated artifacts before continuing.
3. Revise or rerun this phase.
4. Stop and resume later.

Do not begin the next phase until the user selects an option. If the user chooses
review, open or identify requested artifacts and ask again after review.

## Blocking Mid-Phase Choices

Some decisions must be confirmed before a phase can safely finish. Leave the
persisted phase `in-progress`, preserve valid partial artifacts, present the same
decision format, and resume after the answer. Once the phase validates, write its
completion checkpoint and present the normal phase-boundary checkpoint.
