import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, '..');

function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(entryPath) : [entryPath];
    });
}

function relativeMarkdownLinks(content) {
    return [...content.matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]+)?\)/gu)].map((match) => match[1]);
}

test('has valid Skill frontmatter and a matching folder name', () => {
    const content = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    assert.match(content, /^---\n/u);
    assert.match(content, /\n---\n/u);
    assert.match(content, /^name: cosmosdb-relational-migration$/mu);
    assert.match(content, /^description: \|$/mu);
    assert.match(content, /Requires the\n  cosmosdb-best-practices peer Skill\./u);
    assert.equal(path.basename(skillRoot), 'cosmosdb-relational-migration');
});

test('documents natural migration requests without redundant workspace or host instructions', () => {
    for (const file of ['README.md', 'SKILL.md']) {
        const content = fs.readFileSync(path.join(skillRoot, file), 'utf8');
        assert.match(content, /Run a relational database migration to Azure Cosmos DB\./u);
        for (const phase of ['preflight', 'discovery', 'assessment', 'schema conversion']) {
            assert(content.includes(`Run the ${phase} phase of a relational database migration to Azure Cosmos DB.`));
        }
        assert.match(content, /Regenerate the assessment results for a relational database migration to Azure Cosmos DB\./u);
        assert.doesNotMatch(content, /Use the cosmosdb-relational-migration Skill to run/u);
        assert.doesNotMatch(content, /This host supports interaction\./u);
    }
});

test('selects the default mode from host interaction capability and defines phase checkpoints', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const interaction = fs.readFileSync(path.join(skillRoot, 'references', 'workflow', 'interaction-and-checkpoints.md'), 'utf8');
    assert.match(skill, /default to `interactive` on a capable host and\n  `autonomous` otherwise/u);
    assert.match(skill, /normalize to `autonomous` and report that fallback/u);
    assert.match(skill, /interaction capability is unknown, treat it as unsupported/u);
    assert.match(interaction, /Interactive mode is available only when the host can pause execution/u);
    assert.match(interaction, /Autonomous mode is the default when the host cannot pause/u);
    assert.match(skill, /after every phase, including `preflight`/u);
    assert.match(interaction, /Generated or updated artifacts:/u);
    assert.match(interaction, /Continue to the next phase/u);
    assert.match(interaction, /Two to four concrete options/u);
    assert.match(interaction, /Report `artifactCounts`/u);
    assert.match(skill, /`preflight-step`: optional when `phase` is `preflight`/u);
});

test('requires concise findings and report links after each requested task', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const checkpoints = fs.readFileSync(path.join(skillRoot, 'references/workflow/interaction-and-checkpoints.md'), 'utf8');
    assert.match(skill, /After every requested task/u);
    assert.match(skill, /Clickable links to existing in-depth summaries or reports/u);
    assert.match(checkpoints, /focused preflight\/provisioning steps, validation-only/u);
    assert.match(checkpoints, /substantive findings and their\s+migration implications/u);
    assert.match(checkpoints, /not bare paths, inline-code filenames, or a fenced block/u);
    assert.match(checkpoints, /Verify each target exists/u);
    assert.match(checkpoints, /If no report exists yet, say so/u);
    assert.match(checkpoints, /structural checks do not establish source-engine/u);
    for (const report of [
        'phases/1-discovery/preflight-summary.md',
        'phases/1-discovery/discovery-report.md',
        'phases/2-assessment/assessment-summary.md',
        'phases/3-schema-conversion/summary.md',
        'phases/4-provisioning/summary.md',
        'code-migration-plan.md',
    ]) {
        assert(checkpoints.includes(`.cosmosdb-migration/${report}`), `${report} must have a response link mapping`);
    }
});

test('defines completed-phase rerun behavior by mode and explicit intent', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const checkpoints = fs.readFileSync(path.join(skillRoot, 'references', 'workflow', 'interaction-and-checkpoints.md'), 'utf8');
    assert.match(skill, /autonomous mode always\n  regenerates completed phase outputs/u);
    assert.match(skill, /explicit request to\n  validate performs validation only/u);
    assert.match(skill, /`--regenerate` when mode is autonomous/u);
    assert.match(skill, /existing\n  valid outputs are not a stopping condition/u);
    assert.match(checkpoints, /Regenerate all phase-owned output artifacts/u);
    assert.match(checkpoints, /Validate existing artifacts without regenerating them/u);
    assert.match(checkpoints, /execute that intent without\nasking again/u);
    assert.match(checkpoints, /always regenerate its phase-owned output/u);
    assert.match(
        fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'schema-conversion.md'), 'utf8'),
        /Autonomous or explicit regeneration\nreplaces generated domain and root designs without another prompt/u,
    );
    assert.match(
        fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'provisioning.md'), 'utf8'),
        /phase-owned generated artifacts without requesting another confirmation/u,
    );
});

test('resolves conversion concerns independently without premature terminal blockers', () => {
    const conversion = fs.readFileSync(path.join(skillRoot, 'references/phases/schema-conversion.md'), 'utf8');
    const interaction = fs.readFileSync(path.join(skillRoot, 'references/workflow/interaction-and-checkpoints.md'), 'utf8');
    assert.match(conversion, /do not ask permission merely to investigate or propose them/u);
    assert.match(conversion, /separate decisions,\s+not one all-or-nothing conversion contract/u);
    assert.match(conversion, /continue unaffected mappings and\s+domains while it is pending/u);
    assert.match(conversion, /Keep accepted partial results and continue after each decision/u);
    assert.match(conversion, /End early only when the user stops or no authorized work can proceed/u);
    assert.match(conversion, /not proof\s+of a limit violation/u);
    assert.match(conversion, /downstream\s+clearance conditions, not schema-conversion blockers/u);
    assert.match(conversion, /If a pending check could change\s+the model, record the assumption and required follow-up/u);
    assert.match(conversion, /do not claim those checks have passed/u);
    assert.match(conversion, /Design decisions are never terminal blockers/u);
    assert.match(conversion, /Publish a canonical\s+model when its validators pass and no evidenced correctness failure remains/u);
    assert.match(conversion, /`design-decision` entries do not veto publication or phase completion/u);
    assert.doesNotMatch(conversion, /unresolved design-critical choices|unresolved design-critical applicability/u);
    assert.match(conversion, /Never invent source facts,\s+silently weaken explicit requirements/u);
    assert.match(interaction, /Keep independently resolvable concerns in separate questions/u);
    assert.match(interaction, /offer deferral of the affected choice where useful/u);
    assert.match(interaction, /without treating deferral as approval or completed validation/u);
});

test('defines classified design notes separately from evidenced correctness failures', () => {
    const evidence = fs.readFileSync(path.join(skillRoot, 'references/contracts/validation-evidence.md'), 'utf8');
    for (const kind of ['design-decision', 'invalid-model', 'data-loss', 'unsupported-behavior', 'failed-validation']) {
        assert(evidence.includes(`\`${kind}\``));
    }
    assert.match(evidence, /Correctness failures also require a non-empty `evidence` array/u);
    assert.match(evidence, /Completion permits design-decision entries but no unresolved correctness failures/u);
    assert.match(evidence, /review and reclassify existing string entries using their evidence/u);
    assert.match(evidence, /Do not relabel a concrete failure merely to pass a gate/u);
});

test('keeps ranking and incomplete sizing evidence advisory', () => {
    const conversion = fs.readFileSync(path.join(skillRoot, 'references/phases/schema-conversion.md'), 'utf8');
    const evidence = fs.readFileSync(path.join(skillRoot, 'references/contracts/validation-evidence.md'), 'utf8');
    assert.match(conversion, /Scores are comparison aids, not acceptance thresholds/u);
    assert.match(conversion, /low scores do not require additional approval or block conversion/u);
    assert.match(conversion, /qualitative comparison when evidence cannot support numerical scores/u);
    assert.match(conversion, /reject demonstrated capacity or limit violations, not\s+cardinality alone/u);
    assert.doesNotMatch(conversion, /total of at least\s+70|candidate below 70 requires/u);
    assert.match(evidence, /omit\s+indeterminate aggregate estimates/u);
    assert.match(evidence, /missing optional estimates into `blockingIssues`/u);
    assert.match(evidence, /helper omits `estimatedStorageGB` when growth\s+is unknown/u);
    assert.doesNotMatch(evidence, /retention choices must be recorded as blockers/u);
});

test('limits preflight blockers to reliable source inventory and evidence failures', () => {
    const preflight = fs.readFileSync(path.join(skillRoot, 'references/phases/preflight.md'), 'utf8');
    assert.match(preflight, /Block only ambiguity that prevents a faithful source inventory/u);
    assert.match(preflight, /Missing collation metadata or unresolved target handling/u);
    assert.match(preflight, /downstream design concerns, not preflight blockers/u);
    assert.match(preflight, /Do not put target-design uncertainty\s+in `sourceInventory.errors`/u);
    assert.match(preflight, /concrete malformed input or unresolved source identities/u);
    assert.match(preflight, /without requiring their resolution for readiness/u);
    assert.doesNotMatch(preflight, /Material ambiguity blocks|block readiness when\s+they materially affect migration behavior/u);
});

test('permits advisory code-migration concerns without relaxing execution checks', () => {
    const codeMigration = fs.readFileSync(path.join(skillRoot, 'references/phases/code-migration.md'), 'utf8');
    assert.match(codeMigration, /may remain non-empty in plan or migrate\s+mode/u);
    assert.match(codeMigration, /they do not veto completion/u);
    assert.match(codeMigration, /Concrete correctness failures belong in `blockingSteps` and failed validation results/u);
    assert.match(codeMigration, /Required execution checks, SDK compatibility, and output\s+evidence still determine acceptance/u);
});

test('persists request instructions through the version 1 fields', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const projectFormat = fs.readFileSync(path.join(skillRoot, 'references', 'contracts', 'project-state-and-artifacts.md'), 'utf8');
    assert.match(skill, /Before setting a phase `in-progress`, persist additional instructions/u);
    assert.match(projectFormat, /`preflight` or `discovery`: `phases\.discovery\.discoveryInstructions`/u);
    assert.match(projectFormat, /`assessment`: `phases\.assessment\.assessmentInstructions`/u);
    assert.match(projectFormat, /`schema-conversion`: `phases\.schemaConversion\.schemaConversionInstructions`/u);
    assert.match(projectFormat, /`code-migration`: root `migrationInstructions`/u);
    assert.match(projectFormat, /`provisioning` has no free-form instruction field/u);
});

test('resolves every relative Markdown link inside the migration Skill', () => {
    const markdownFiles = walk(skillRoot).filter((filePath) => filePath.endsWith('.md'));
    const missing = [];
    for (const filePath of markdownFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        for (const link of relativeMarkdownLinks(content)) {
            const target = path.resolve(path.dirname(filePath), link);
            if (!fs.existsSync(target)) missing.push(`${path.relative(skillRoot, filePath)} -> ${link}`);
        }
    }
    assert.deepEqual(missing, []);
});

test('groups references by purpose and links every guide directly from the Skill', () => {
    const referencesRoot = path.join(skillRoot, 'references');
    const groups = fs.readdirSync(referencesRoot, { withFileTypes: true });
    assert(groups.every(entry => entry.isDirectory()));
    assert.deepEqual(groups.map(entry => entry.name).sort(), ['contracts', 'phases', 'tooling', 'workflow']);
    assert.deepEqual(fs.readdirSync(path.join(referencesRoot, 'phases')).sort(), [
        'assessment.md',
        'code-migration.md',
        'discovery.md',
        'preflight.md',
        'provisioning.md',
        'schema-conversion.md',
    ]);
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const linkedPaths = new Set(relativeMarkdownLinks(skill).map(link => path.resolve(skillRoot, link)));
    for (const referencePath of walk(referencesRoot)) {
        assert.equal(path.extname(referencePath), '.md');
        assert.equal(path.relative(referencesRoot, referencePath).split(path.sep).length, 2);
        assert(linkedPaths.has(referencePath), `${path.relative(skillRoot, referencePath)} must be directly linked`);
    }
});

test('documents dependency permission, persisted choice, model-only procedure and minimal results', () => {
    const reference = fs.readFileSync(path.join(skillRoot, 'references/workflow/ddl-interpretation.md'), 'utf8');
    const evidence = fs.readFileSync(path.join(skillRoot, 'references/contracts/validation-evidence.md'), 'utf8');
    assert.match(reference, /May I use \[SQLGlot\]\(https:\/\/github\.com\/tobymao\/sqlglot\)/u);
    assert.match(reference, /phases\.discovery\.ddlParsing/u);
    assert.match(reference, /unattended-default/u);
    assert.match(reference, /Model-Only DDL Interpretation/u);
    assert.match(reference, /second completeness pass/u);
    assert.match(reference, /Do\s+not install or invoke SQLGlot/u);
    assert.match(evidence, /Assurance Contract/u);
    assert.match(evidence, /does\s+not discover arbitrary malformed SQL/u);
    assert.match(evidence, /source-engine-validated/u);
    assert.match(reference, /authoritative vendor documentation/u);
    assert.match(reference, /fallbackReason: "unsupported-dialect" \| "unavailable"/u);
    assert.match(reference, /unattended-default.*warn and continue with model-only/isu);
    assert.match(reference, /saved `interactive`\/`explicit` SQLGlot selection.*abort/isu);
    assert.match(reference, /latest available SQLGlot release/u);
    assert.match(reference, /host's execution approvals, sandbox\s+restrictions, and network permissions/u);
    assert.match(reference, /without modifying application\s+dependencies or global Python/u);
    assert.match(reference, /record it in the source inventory's\s+`parser\.version`/u);
    assert.doesNotMatch(reference, /setup-ddl-parser|requirements-ddl|pinned version|Python 3\.11/u);
    assert.match(evidence, /Artifact Budget/u);
    for (const scriptName of ['extract-ddl.mjs', 'extract-ddl.py']) {
        assert.equal(fs.existsSync(path.join(skillRoot, 'scripts', scriptName)), false);
    }
});

test('ships an opt-in real SQLGlot DDL evaluation without affecting parser-free tests', () => {
    const evaluationTest = fs.readFileSync(path.join(skillRoot, 'tests', 'sqlglot-evaluation.test.mjs'), 'utf8');
    assert.match(evaluationTest, /MIGRATION_SQLGLOT_EVALUATION_PYTHON/u);
    assert.match(evaluationTest, /MIGRATION_SQLGLOT_EVALUATION_MODULE_PATH/u);
    for (const dialect of ['tsql', 'postgres', 'mysql', 'oracle', 'sqlite']) {
        assert.match(evaluationTest, new RegExp(`dialect: '${dialect}'`, 'u'));
    }
    assert.match(evaluationTest, /skip: !evaluationPython/u);
    assert.match(evaluationTest, /SQLGlot version: \$\{report\.version\}/u);
    assert.equal(fs.existsSync(path.join(skillRoot, 'scripts', 'setup-ddl-parser.mjs')), false);
    assert.equal(fs.existsSync(path.join(skillRoot, 'scripts', 'requirements-ddl.txt')), false);
});

test('documents an advisory SQLGlot fallback with artifact provenance and limited assurance', () => {
    const reference = fs.readFileSync(path.join(skillRoot, 'references/workflow/ddl-interpretation.md'), 'utf8');
    assert.match(reference, /### Tested Fallback Release/u);
    assert.match(reference, /SQLGlot 30\.22\.0/u);
    assert.match(reference, /2026-10-09/u);
    assert.match(reference, /sqlglot-30\.22\.0-py3-none-any\.whl/u);
    assert.match(reference, /90aa461490fcd95d14ec3842a97506ae20f6d3e9313307ad31be793d479cca65/u);
    assert.match(reference, /not a default version pin or a security audit/u);
    assert.match(reference, /Honor\s+explicit user version constraints and model-only choices/u);
    assert.match(reference, /independently trusted cached or mirrored\s+copy/u);
    assert.match(reference, /Do not fetch executable code or\s+replacement digests/u);
    assert.match(reference, /existing unavailable-parser fallback or abort policy/u);
});

test('keeps core workflow documentation host-neutral', () => {
    const markdownFiles = walk(skillRoot).filter(
        (filePath) => filePath.endsWith('.md') && filePath !== path.join(skillRoot, 'README.md'),
    );
    for (const filePath of markdownFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        assert.doesNotMatch(content, /\bUX\b|webview|VS Code/iu, path.relative(skillRoot, filePath));
    }
});

test('ships a parseable model JSON Schema', () => {
    const schemaPath = path.join(skillRoot, 'schemas', 'cosmos-model.schema.json');
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    assert.equal(schema.type, 'object');
    assert.equal(schema.properties.version.const, 1);
    assert(schema.required.includes('containers'));
});

test('requires version 1 compatible project checkpoints', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const validator = fs.readFileSync(path.join(skillRoot, 'scripts', 'validate-migration-project.mjs'), 'utf8');
    const projectFormat = fs.readFileSync(path.join(skillRoot, 'references', 'contracts', 'project-state-and-artifacts.md'), 'utf8');
    const preflight = fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'preflight.md'), 'utf8');
    assert.match(skill, /project-state\.mjs --set <json-pointer> --value <json> --expect <revision>/u);
    assert.match(skill, /It removes its temporary candidate/u);
    assert.match(skill, /validation, conflict detection, or replacement fails/u);
    assert.match(validator, /project\.sourceCode !== 'parent'/u);
    assert.match(validator, /validateAssessmentDomain/u);
    assert.match(validator, /validateAccessPattern/u);
    assert.match(projectFormat, /all four evaluation gates pass/u);
    assert.match(projectFormat, /preflight-manifest\.json#sourceInventory/u);
    assert.match(preflight, /preflight-manifest\.json#sourceInventory/u);
    assert.doesNotMatch(projectFormat, /all five conditions/u);
    assert.doesNotMatch(preflight, /inventory in the preflight summary/u);
});

test('Discovery prepares preflight in application-details-first order without weakening validation', () => {
    const discovery = fs.readFileSync(path.join(skillRoot, 'references/phases/discovery.md'), 'utf8');
    const preflight = fs.readFileSync(path.join(skillRoot, 'references/phases/preflight.md'), 'utf8');
    const interaction = fs.readFileSync(path.join(skillRoot, 'references/workflow/interaction-and-checkpoints.md'), 'utf8');
    assert.deepEqual([...preflight.matchAll(/^## \d\. (.+)$/gmu)].map(match => match[1]), [
        'Application Details', 'Schema Acquisition', 'Volumetrics', 'Access Patterns',
    ]);
    assert.match(discovery, /`application-details`,\s+`schema-acquisition`, `volumetrics`, `access-patterns`/u);
    assert.match(discovery, /check-phase-completion\.mjs --phase preflight/u);
    assert.match(discovery, /A validation-only request performs no preparation writes/u);
    assert.match(discovery, /preserve\s+valid supplied inputs/u);
    assert.match(interaction, /source discovery without asking for a separate launch/u);
});

test('Discovery preserves source constraints and reviews their write-pattern handoff', () => {
    const discovery = fs.readFileSync(path.join(skillRoot, 'references/phases/discovery.md'), 'utf8');
    const evidence = fs.readFileSync(path.join(skillRoot, 'references/contracts/validation-evidence.md'), 'utf8');
    assert.match(evidence, /column nullability, length, precision\/scale, resolved alias types, and\s+declared checks/u);
    assert.match(evidence, /`unknown` from `not applicable`/u);
    assert.match(discovery, /link each write-pattern ID to applicable inventory\s+constraints/u);
    assert.match(discovery, /current enforcement: database, ORM, application, or unknown/u);
    assert.match(discovery, /database-only protections as downstream obligations/u);
    assert.match(discovery, /every write pattern, or explains\s+why none apply/u);
    assert.match(discovery, /agent review, not proof of runtime enforcement/u);
});

test('keeps human invocation examples free of manifest details', () => {
    const reference = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
    const examples = [...reference.matchAll(/```text\n([\s\S]*?)\n```/gu)];
    assert(examples.length > 0, 'Human invocation examples must be present');
    for (const [, example] of examples) {
        assert.doesNotMatch(example, /\bmanifests?\b/iu);
    }
});

test('keeps the human README outside the agent reference graph', () => {
    const readmePath = path.join(skillRoot, 'README.md');
    assert(fs.existsSync(readmePath));
    assert.equal(fs.existsSync(path.join(skillRoot, 'references/tooling/host-setup-and-invocation.md')), false);
    const instructionFiles = [path.join(skillRoot, 'SKILL.md'), ...walk(path.join(skillRoot, 'references'))];
    for (const filePath of instructionFiles.filter(filePath => filePath.endsWith('.md'))) {
        const content = fs.readFileSync(filePath, 'utf8');
        for (const link of relativeMarkdownLinks(content)) {
            assert.notEqual(path.resolve(path.dirname(filePath), link), readmePath);
        }
    }
    for (const link of relativeMarkdownLinks(fs.readFileSync(readmePath, 'utf8'))) {
        assert(fs.existsSync(path.resolve(skillRoot, link)), `README link must resolve: ${link}`);
    }
});

test('documents every helper and separates CLI recovery from workflow invocation inputs', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const reference = fs.readFileSync(path.join(skillRoot, 'references/tooling/helper-commands.md'), 'utf8');
    assert.match(skill, /<helper>\.mjs --help/u);
    assert.match(skill, /not a shared CLI option schema/u);
    assert.match(skill, /validation-only request must\s+never add `--regenerate`/u);
    assert.match(reference, /## Import-Only Modules/u);
    const documentedPaths = relativeMarkdownLinks(reference).map(link =>
        path.resolve(skillRoot, 'references/tooling', link),
    );
    for (const scriptName of fs.readdirSync(path.join(skillRoot, 'scripts'))) {
        assert.ok(
            documentedPaths.includes(path.join(skillRoot, 'scripts', scriptName)),
            `${scriptName} must be documented`,
        );
    }
});

test('ships executable workflow, rule-provenance, and model-merge helpers', () => {
    for (const scriptName of [
        'freshness.mjs',
        'project-state.mjs',
        'phase-summary.mjs',
        'identity-mapping.mjs',
        'reconcile-capacity.mjs',
        'validate-source-evidence.mjs',
        'validate-conversion-evidence.mjs',
        'calculate-capacity.mjs',
        'estimate-domain-tokens.mjs',
        'generate-provisioning-artifacts.mjs',
        'phase-names.mjs',
        'inspect-migration-state.mjs',
        'merge-cosmos-models.mjs',
        'select-schema-conversion-domains.mjs',
        'validate-code-migration-plan.mjs',
        'validate-schema-conversion-domains.mjs',
        'validate-schema-conversion-summary.mjs',
        'validate-sample-data.mjs',
        'validate-provisioning-verification.mjs',
    ]) {
        assert(fs.existsSync(path.join(skillRoot, 'scripts', scriptName)), `${scriptName} must be packaged`);
    }
    assert.equal(fs.existsSync(path.join(skillRoot, 'references', 'best-practices-profiles.json')), false);
    assert.equal(fs.existsSync(path.join(skillRoot, 'scripts', 'resolve-best-practices.mjs')), false);
    assert.equal(fs.existsSync(path.join(skillRoot, 'scripts', 'validate-best-practices.mjs')), false);
});

test('keeps best-practice guidance model-owned and outside execution freshness', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const dependency = fs.readFileSync(path.join(skillRoot, 'references', 'workflow', 'best-practices-integration.md'), 'utf8');
    assert.match(dependency, /The model owns semantic rule selection/u);
    assert.match(dependency, /Peer guidance is not a freshness dependency/u);
    assert.match(dependency, /Existing peer-file freshness\s+entries are ignored/u);
    assert.match(dependency, /required\s+before making new Cosmos DB decisions/u);
    assert.match(dependency, /Record applied rule paths and their effect in the phase summary/u);
    assert.match(skill, /The model owns semantic relevance and interpretation/u);
    assert.match(skill, /Peer guidance is not a freshness dependency/u);
    for (const filePath of walk(skillRoot).filter(filePath => filePath.endsWith('.md'))) {
        assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /--peer(?:-rule)?\b/u, filePath);
    }
});

test('documents canonical schema-conversion artifacts with supported CLI options', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const reference = fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'schema-conversion.md'), 'utf8');
    const modelValidator = fs.readFileSync(path.join(skillRoot, 'scripts', 'validate-cosmos-model.mjs'), 'utf8');
    const merge = fs.readFileSync(path.join(skillRoot, 'scripts', 'merge-cosmos-models.mjs'), 'utf8');

    assert.match(skill, /human-readable analysis in summaries, machine-readable evidence in\nmanifests, and complete models only in model JSON files/u);
    assert.doesNotMatch(skill, /evidence, and verification inside those summaries, not sidecars/u);
    assert.match(reference, /complete model only in `cosmos-model\.json`/u);
    assert.match(reference, /validate-schema-conversion-domains\.mjs/u);
    assert.match(reference, /--reference-manifest <root-manifest\.json>/u);
    assert.match(reference, /--domain <DomainName>=<domain-directory>/u);
    assert.match(reference, /--manifest <root-manifest\.json>/u);
    assert.match(reference, /--input <DomainName>=<domain-cosmos-model\.json>/u);
    assert.match(reference, /run exactly one\n`check-phase-completion\.mjs --phase schema-conversion`/u);
    assert.doesNotMatch(reference, /--reference-summary|--summary <root-summary|models embedded in per-domain summaries/u);
    assert.doesNotMatch(reference, /node <skill-root>\/scripts\/validate-cosmos-model\.mjs/u);
    assert.doesNotMatch(reference, /node <skill-root>\/scripts\/validate-schema-conversion-summary\.mjs/u);
    assert.match(modelValidator, /arg === '--reference-manifest'/u);
    assert.doesNotMatch(modelValidator, /--reference-summary/u);
    assert.match(merge, /argument === '--manifest'/u);
    assert.doesNotMatch(merge, /argument === '--summary'/u);
});

test('defines centralized transitive freshness and bounded project access', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const evidence = fs.readFileSync(path.join(skillRoot, 'references', 'contracts', 'freshness.md'), 'utf8');
    assert.match(skill, /scripts\/freshness\.mjs/u);
    assert.match(skill, /freshness: "stale" \| "unknown"/u);
    const projectFormat = fs.readFileSync(path.join(skillRoot, 'references', 'contracts', 'project-state-and-artifacts.md'), 'utf8');
    assert.match(evidence, /project\.json#freshness\[phase\]/u);
    assert.match(evidence, /atomically updates the project and prints only the new revision/u);
    assert.match(evidence, /outputs` array/u);
    assert.match(skill, /convenience helper, not a mandatory read gateway/u);
    assert.match(skill, /do not stop\s+solely because the helper failed/u);
    assert.match(projectFormat, /convenience helper, not a mandatory read gateway/u);
    assert.match(projectFormat, /chunked or whole-file reads\s+as needed/u);
    assert.match(projectFormat, /oversized strings that the helper cannot paginate/u);
    assert.match(projectFormat, /limit applies only to helper responses/u);
    assert.match(projectFormat, /do not authorize checkpoint mutation, bypass validation or\s+revision conflicts/u);
    assert.doesNotMatch(projectFormat, /Do not read, print, or rewrite the whole project file in model context/u);
    assert.match(projectFormat, /--get \/phases\/assessment\/domains --offset 0 --limit 10/u);
    assert.match(skill, /project-state\.mjs --toc/u);
    assert.match(projectFormat, /--toc \/phases\/discovery/u);
    assert.match(projectFormat, /--toc \/freshness\/preflight\/inputs --offset 0 --limit 10/u);
    assert.match(projectFormat, /never stored values/u);
    assert.match(projectFormat, /`nextOffset` is present only when more children remain/u);
    assert.match(projectFormat, /16 KiB/u);
    assert.match(evidence, /required predecessor is\s+current/u);
    assert.match(evidence, /Missing checkpoint freshness entries are `unknown`/u);
    assert.match(evidence, /`discovery`: `preflight-manifest\.json`/u);
    assert.match(evidence, /`assessment`: `discovery-manifest\.json`/u);
    assert.doesNotMatch(evidence, /freshness\.json/u);
});

test('documents bounded and pageable completion diagnostics', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const projectFormat = fs.readFileSync(path.join(skillRoot, 'references', 'contracts', 'project-state-and-artifacts.md'), 'utf8');
    const checkpoints = fs.readFileSync(path.join(skillRoot, 'references', 'workflow', 'interaction-and-checkpoints.md'), 'utf8');
    assert.match(skill, /Truncation never changes the validation exit status/u);
    assert.match(projectFormat, /emits at most 16 KiB of JSON/u);
    assert.match(projectFormat, /--offset <nextOffset>/u);
    assert.match(projectFormat, /--artifact <workspace-relative-path>/u);
    assert.match(projectFormat, /oversized top-level project errors expose `nextErrorOffset`/u);
    assert.match(checkpoints, /Do not expand present\nartifacts into full contents or exhaustive inventories/u);
});

test('avoids redundant validators while retaining an authoritative completion gate', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const projectFormat = fs.readFileSync(path.join(skillRoot, 'references', 'contracts', 'project-state-and-artifacts.md'), 'utf8');
    const schemaConversion = fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'schema-conversion.md'), 'utf8');
    const evidence = fs.readFileSync(path.join(skillRoot, 'references', 'contracts', 'validation-evidence.md'), 'utf8');
    assert.match(skill, /Do not immediately\n  invoke `check-phase-completion\.mjs` for the same phase/u);
    assert.match(skill, /phase-specific validators as generation preconditions or targeted repair\n  tools/u);
    assert.match(projectFormat, /do not immediately run\n`check-phase-completion\.mjs` again/u);
    assert.match(schemaConversion, /validate all domain models and\nsummaries in one process/u);
    assert.match(schemaConversion, /run exactly one\n`check-phase-completion\.mjs --phase schema-conversion`/u);
    assert.match(evidence, /standalone conversion-evidence command only to isolate a failure/u);
    assert.match(evidence, /To isolate a summary-specific failure/u);
    assert.match(evidence, /Do not run both individual commands after a successful batch/u);
});

test('uses context-aware working-set estimates without a fixed split threshold', () => {
    const assessment = fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'assessment.md'), 'utf8');
    const projectFormat = fs.readFileSync(path.join(skillRoot, 'references', 'contracts', 'project-state-and-artifacts.md'), 'utf8');
    const estimator = fs.readFileSync(path.join(skillRoot, 'scripts', 'estimate-domain-tokens.mjs'), 'utf8');
    assert.match(assessment, /full known working set/u);
    assert.match(assessment, /default output reserve is 20% and the safety margin\nis 10%/u);
    assert.match(assessment, /`budgetStatus` is `exceeds` and\n`splitRequired` is `true`/u);
    assert.match(assessment, /`budgetStatus: "unknown"`/u);
    assert.match(projectFormat, /does not imply a fixed context threshold/u);
    assert.match(estimator, /DEFAULT_CHARACTERS_PER_TOKEN = 3/u);
    assert.doesNotMatch(assessment, /150,?000|four-characters-per-token/u);
    assert.doesNotMatch(estimator, /DEFAULT_SPLIT_THRESHOLD|150000/u);
});

test('uses named public phase identifiers', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    for (const phase of [
        'preflight',
        'discovery',
        'assessment',
        'schema-conversion',
        'provisioning',
        'code-migration',
    ]) {
        assert(skill.includes(`\`${phase}\``), `${phase} must be documented as a named phase`);
    }
    assert.doesNotMatch(skill, /Phase [0-4]|phase [0-4]/u);
});

test('defines one adaptive schema-conversion workflow', () => {
    const reference = fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'schema-conversion.md'), 'utf8');
    assert.match(reference, /The Skill has one schema-conversion workflow/u);
    assert.match(reference, /same design,\s+evidence, validation, and canonical model contract/u);
    assert.match(reference, /When `include-unmapped-domains` is omitted or false/u);
    assert.match(reference, /never silently widen scope/u);
    assert.doesNotMatch(reference, /Thorough mode|Fast mode/u);
});

test('defines focused provisioning and first-class code-migration routing', () => {
    const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const provisioning = fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'provisioning.md'), 'utf8');
    const codeMigration = fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'code-migration.md'), 'utf8');
    assert.match(skill, /`target-account` or `resources-and-data`/u);
    assert.match(provisioning, /Both focused steps require `allow-provisioning: true`/u);
    assert.match(provisioning, /successful\n`target-account` step does not mark the phase complete/u);
    assert.match(codeMigration, /In plan mode, stop after validating the plan/u);
    assert.match(codeMigration, /In migrate mode, apply changes/u);
    assert.match(codeMigration, /Converted domains do not have separate manifests/u);
    assert.match(codeMigration, /`modelSha256`/u);
    assert.match(codeMigration, /`sdkReportSha256`/u);
    assert.match(codeMigration, /JSON\.stringify\(sdkCompatibility, null, 2\)/u);
    assert.match(codeMigration, /unique model-selected rule paths and unresolved concerns/u);
    assert.match(codeMigration, /after symlink resolution/u);
    assert.match(codeMigration, /Derive the action only from the current request prompt/u);
    assert.match(codeMigration, /Checkpoint metadata never authorizes\s+application edits or determines the requested action/u);
    assert.match(codeMigration, /Review every candidate execution blocker during planning/u);
    assert.match(codeMigration, /ask the user now/u);
    assert.match(codeMigration, /Defer a blocker only when planning cannot resolve it/u);
    assert.match(codeMigration, /`Blocker Review` must inventory all candidate blockers/u);
    assert.match(codeMigration, /Every\nrecommendation rationale must cite evidence or constraints/u);
    assert.match(skill, /Follow every recommendation with a rationale/u);
    assert.match(skill, /compares the material alternatives/u);
    assert.match(skill, /otherwise\n  default to planning/u);
    assert.match(skill, /There is no code-migration mode parameter/u);
    assert.doesNotMatch(codeMigration, /Start mode|start mode|start-mode/u);
});

test('distinguishes model capacity from compatible provisioning targets', () => {
    const provisioning = fs.readFileSync(path.join(skillRoot, 'references/phases/provisioning.md'), 'utf8');
    assert.match(provisioning, /Serverless \| Provisioned \| Compatible/u);
    assert.match(provisioning, /Provisioned \| Serverless \| Cannot satisfy provisioned throughput requirements/u);
    assert.match(provisioning, /new serverless account in the\s+same resource group and subscription/u);
    assert.match(provisioning, /offer the selected account with approved\s+autoscale throughput or a new serverless account/u);
    assert.match(provisioning, /phases.targetEnvironment.capacityMode/u);
    assert.match(provisioning, /phases.targetEnvironment.maxThroughput/u);
    assert.match(provisioning, /Neither requires a model rewrite or schema-conversion rerun/u);
    assert.match(provisioning, /mismatches in either direction are warnings, not blockers/u);
    assert.match(provisioning, /serverless emulator omits throughput settings\s+even for a provisioned model/u);
    assert.match(provisioning, /never substitute expected capacity for readback/u);
    assert.match(provisioning, /never infer it from the model or missing throughput/u);
    assert.match(provisioning, /Switch targets only after approval; a new account needs a distinct, available name/u);
    assert.match(provisioning, /review existing or shared throughput before applying changes/u);
    assert.match(provisioning, /Keep the canonical model and Azure Bicep unchanged/u);
});

test('requires access setup before connectivity and blocks permission denial', () => {
    const provisioning = fs.readFileSync(path.join(skillRoot, 'references/phases/provisioning.md'), 'utf8');
    assert.match(provisioning, /With `allow-provisioning: true`, establish required access for new and existing Azure/u);
    assert.match(provisioning, /accounts before testing connectivity/u);
    assert.match(provisioning, /signed-in user's authority/u);
    assert.match(provisioning, /Cosmos DB Built-in Data Contributor/u);
    assert.match(provisioning, /Include new-account grants\s+in the initial approval/u);
    assert.match(provisioning, /bounded backoff for RBAC propagation/u);
    assert.match(provisioning, /If a grant is denied or access still fails, block the step/u);
    assert.match(provisioning, /required administrator action/u);
    assert.doesNotMatch(provisioning, /account-level change or new access grant requires a separate/u);
});

test('requires substantive execution checks without treating command names as proof', () => {
    const reference = fs.readFileSync(path.join(skillRoot, 'references/phases/code-migration.md'), 'utf8');
    const sample = JSON.parse(reference.match(/```json\n([\s\S]*?)\n```/u)[1]);
    assert.deepEqual(sample.validation.flatMap(result => result.checks), ['build', 'behavior']);
    assert(sample.validation.every(result => result.coverage && result.command && result.exitCode === 0));
    assert.match(reference, /no minimum successful-command count/u);
    assert.match(reference, /Required but unavailable checks remain blockers/u);
    assert.match(reference, /It does not classify\s+command names, execute them/u);
    assert.match(reference, /never mark unexecuted checks as passed/u);
    assert.match(reference, /coverage text and category labels are not proof/u);
    assert.match(reference, /fictional \.NET application/u);
    assert.match(reference, /application need not use Node\.js/u);
    assert.match(reference, /Do not copy validation\s+commands from the extension repository/u);
    for (const stack of ['.NET', 'Maven', 'Gradle', 'Python', 'Go', 'JavaScript / TypeScript']) {
        assert(reference.includes(`| ${stack}`) || reference.includes(`/ ${stack} |`), `${stack} validation must be illustrated`);
    }
    assert.match(reference, /polyglot applications, cover every\s+affected component/u);
    assert.match(reference, /no build step while still requiring\s+behavioral tests/u);
});

test('passes the provisioning verification manifest to its validator example', () => {
    const reference = fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'provisioning.md'), 'utf8');
    const command = [...reference.matchAll(/```bash\n([\s\S]*?)\n```/gu)]
        .map(match => match[1])
        .find(block => block.startsWith('node <skill-root>/scripts/validate-provisioning-verification.mjs'));
    assert.ok(command, 'Provisioning verification command must be documented');
    assert.match(command, /<workspace>\/\.cosmosdb-migration\/phases\/4-provisioning\/manifest\.json\s*$/u);
    assert.doesNotMatch(command, /summary\.md/u);
    assert.match(reference, /`target\.endpoint`/u);
    assert.match(reference, /actual JSON object returned by the point read/u);
    assert.match(reference, /Never substitute expected samples or upsert request bodies for read responses/u);
    assert.match(reference, /validator checks recorded evidence, not live resources/u);
});

test('keeps Azure seed scripts data-only while preserving emulator provisioning', () => {
    const provisioning = fs.readFileSync(path.join(skillRoot, 'references/phases/provisioning.md'), 'utf8');
    const conversion = fs.readFileSync(path.join(skillRoot, 'references/phases/schema-conversion.md'), 'utf8');
    assert.match(provisioning, /Azure seed scripts are always data-only/u);
    assert.match(provisioning, /Deploy and verify `main.bicep` first/u);
    assert.match(provisioning, /Do not replay `create`, `index set`, or\s+`throughput` commands against Bicep-created resources/u);
    assert.match(provisioning, /Only emulator scripts without container-level full-text or unique-key policies\s+include resource operations/u);
    assert.match(provisioning, /never delete\/recreate containers/u);
    assert.match(provisioning, /not live mutation, configuration convergence, or write success/u);
    assert.match(conversion, /validator rejects explicit root `id` entries/u);
    assert.match(conversion, /does not prohibit `\/id` partition keys, composite-index\s+paths, or nested application properties/u);
});

test('requires a minimum Shell version and preserves sufficiently recent installations', () => {
    const provisioning = fs.readFileSync(path.join(skillRoot, 'references', 'phases', 'provisioning.md'), 'utf8');
    assert.match(provisioning, /Minimum required version:.*Cosmos DB Shell[\s\S]*`1\.1\.250-preview` or newer/u);
    assert.match(provisioning, /semantic version precedence, not string ordering/u);
    assert.match(provisioning, /Keep any installed version at or above the minimum unchanged/u);
    assert.match(provisioning, /Update only if the installed version is lower\s+than `1\.1\.250-preview`/u);
    assert.match(provisioning, /dotnet --list-sdks/u);
    assert.match(provisioning, /dotnet tool list --global/u);
    assert.match(provisioning, /dotnet tool install --global CosmosDBShell --prerelease/u);
    assert.match(provisioning, /dotnet tool update --global CosmosDBShell --prerelease/u);
    assert.match(provisioning, /Verify the\s+resolved version meets the minimum/u);
    assert.match(provisioning, /Obtain\s+approval under the host's installation and network controls/u);
    assert.match(provisioning, /If `dotnet`\s+or a suitable SDK is unavailable/u);
    assert.match(provisioning, /--add-source/u);
    assert.match(provisioning, /--check-shell <cosmosdbshell-executable>/u);
    assert.doesNotMatch(provisioning, /7271532|local build `|tested source baseline|--version 1\.1\.250-preview/u);
});

test('ships the SDK compatibility matrix and official documentation source', () => {
    const reference = fs.readFileSync(path.join(skillRoot, 'references', 'contracts', 'sdk-compatibility.md'), 'utf8');
    const script = fs.readFileSync(path.join(skillRoot, 'scripts', 'check-sdk-compatibility.mjs'), 'utf8');
    assert.match(reference, /https:\/\/learn\.microsoft\.com\/azure\/cosmos-db\/quickstart-dotnet/u);
    assert.match(reference, /Rust.*public preview/u);
    assert.match(reference, /valid unsupported classification does\s+not block/u);
    assert.match(reference, /Missing or invalid SDK evidence prevents discovery completion/u);
    assert.match(reference, /`phases\/1-discovery\/discovery-manifest\.json`/u);
    assert.doesNotMatch(reference, /discovery report's\s+preflight manifest/u);
    assert.match(script, /MATRIX_VERIFIED_AT/u);
});
