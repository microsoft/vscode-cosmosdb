# Data Modeler telemetry

## Scope

Track the modeling journey and a small set of intentional interactions, not every control or keystroke:

- Wizard footer buttons.
- Explicit workload/scenario selections in the first step.
- Schema upload intent and import outcomes.
- Data, Queries, and Scale tab activations, separately from unique section views.
- Successfully added schema fields.
- The submitted container count and differences from scenario defaults when requesting a recommendation.
- Recommendation delivery, feedback, deployment/export actions, and persistence health.

Ordinary field typing, dropdown changes, hover/focus, individual property removal, and every row-level button are not
separate interaction events. Their effect on the model is reflected in aggregate default-difference flags.

## Events

New feature events use the static prefix `cosmosDB.dataModeler.`.

| Suffix                    | Meaning                                                                                   | Principal properties / measurements                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `opened`                  | A new modeler panel was created                                                           | `panelId`                                                                                                       |
| `sessionChoice`           | New work, continuing saved work, or replacing saved work                                  | `sessionChoice`: `new`, `continued`, `replaced`                                                                 |
| `scenarioSelected`        | A workload card was explicitly selected in the first step                                 | `scenario`, `firstSelection`, `scenarioSelectionCount`                                                          |
| `step`                    | A normalized wizard step was displayed                                                    | `step`, `firstVisit`                                                                                            |
| `control`                 | An allowlisted footer button or container tab was activated, or Upload JSON was activated | `controlId`                                                                                                     |
| `schemaImport`            | A selected JSON file was applied, could not be read/parsed, or was not confirmed          | `outcome`: `success`, `error`, `cancelled`                                                                      |
| `fieldAdded`              | A new, nonempty, nonduplicate property was added with Enter                               | No property name or value                                                                                       |
| `recommendationRequested` | Saved inputs reached the host for a recommendation                                        | `retry`, `attemptNumber`, `requestedContainerCount`, current model summary                                      |
| `recommendationReceived`  | The report tool delivered a result                                                        | `source`, model identity, container coverage/completeness counts, `requestToReceivedMs` for correlated requests |
| `recommendationDisplayed` | The Result page displayed a nonempty result                                               | `source`, `requestToDisplayedMs`, `receivedToDisplayedMs` for correlated requests                               |
| `recommendationOutcome`   | An error or an unfinished attempt ended                                                   | Bounded `outcome` / `errorCategory`, duration when correlated                                                   |
| `feedback`                | The user chose thumbs up/down                                                             | `vote`: `up`, `down`; model identity of the rated result                                                        |
| `action`                  | A meaningful post-result or deployment-code action                                        | `action`, optional `method`, `outcome`, `codeCustomized`                                                        |
| `deployment`              | Direct resource provisioning completed or failed                                          | `outcome`, `databaseMode`, `writesStarted`, duration, created/existing counts                                   |
| `export`                  | Deployment code generation completed or failed                                            | `method`, `databaseMode`, `outcome`, duration                                                                   |
| `openDataExplorer`        | Opening Data Explorer completed or failed                                                 | `outcome`, duration                                                                                             |
| `persistenceLoad`         | Loading saved work completed or failed                                                    | `outcome`, `savedStateFound`, `recovered`                                                                       |
| `summary`                 | Best-effort panel close rollup                                                            | Last/visited steps, latest usage, visible time, attempts/results, import/field counters, persistence counters   |

Common enrichment includes the latest safe usage aggregates and the session choice when known. Numbers are measurements;
enums and stringified booleans are properties. Autosaves and aggregate updates do not emit an event per save/edit.

### Workload choices

`scenario` was already included on usage milestones and is recomputed from the submitted inputs for each recommendation.
`scenarioSelected` additionally records every explicit workload-card selection immediately, even if the user never clicks
Start or requests a recommendation. Mouse and keyboard selections follow the same path.

- `scenario` is the built-in ID: `chat`, `ecommerce`, `iot`, `multitenant`, `rag`, `social`, `catalog`, `gaming`,
  `profiles`, `eventsourcing`, `analytics`, `cms`, `ledger`, `inventory`, `booking`, or `other`.
- `firstSelection` is true only for the first explicit selection in this open panel.
- `scenarioSelectionCount` is a numeric session counter. Re-selecting the same card counts because it reapplies defaults.
- The close summary also records `firstSelectedScenario` and `lastSelectedScenario` when a selection occurred.
- Loading a saved model or displaying the Workload page does not fabricate a selection event. The selected ID is sent
  directly; stale aggregates from the previously selected workload are not attached to this event.
- Card labels, descriptions, and scenario-filter text are never sent.

### Footer buttons and tab activations

The `controlId` allowlist is:

| Area           | IDs                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wizard footer  | `footerStart`, `footerNext`, `footerBack`, `footerGetRecommendation`, `footerDeploy`, `footerStartOver`, `footerAddContainer`, `footerRemoveContainer` |
| Container tabs | `containerDataTab`, `containerQueriesTab`, `containerScaleTab`                                                                                         |
| Schema upload  | `schemaUpload`                                                                                                                                         |

Mouse and keyboard activation use the same event. Repeated enabled activations count separately; disabled controls do not
count. Merely displaying Data as the default tab does not produce a tab-click event.

Footer events measure **intent**, not success: Add Container opens a dialog, Remove Container requests confirmation, and
Get Recommendation can be cancelled or blocked by persistence failure. The actual submitted request and its container count
are recorded separately. The footer Deploy button enters the deployment step; it is not evidence of resource creation.
The deployment page's direct provisioning result is recorded by `deployment`.

`action` values remain: `enterDeploy`, `returnToEditing`, `retryRecommendation`, `startOver`, `copyCode`,
`selectDeploymentMethod`, and `regenerateCode`. Do not sum these together with `control` events as a single click metric.
Copying generated code is not counted as a successful deployment.

### Schema imports and new fields

- `schemaUploaded` means **at least one successful JSON schema import in this open panel**, not that the current model
  necessarily still uses that schema.
- `schemaImportSuccessCount`, `schemaImportErrorCount`, and `schemaImportCancelledCount` accumulate during the panel session.
- `cancelled` means no confirmed schema replacement, including dismissal of the picker/confirmation or an unavailable
  confirmation dialog. It must not be interpreted as proof of an explicit user rejection.
- `fieldsAddedCount` counts successful manual additions. Typing without Enter, empty input, and duplicate field names do not
  count. Fields inferred from an uploaded document are not manual additions.
- The current UI imports JSON files; this change does not introduce paste or drag-and-drop import flows.

## Defaults at Get Recommendation

The host recomputes the following from the **submitted wizard state**, rather than relying on a potentially stale webview
summary:

| Field                                           | Meaning                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `requestedContainerCount`                       | Number of containers sent for this particular recommendation attempt         |
| `containerCount`, `propertyCount`, `queryCount` | Current model size                                                           |
| `scenario`                                      | Built-in scenario identifier, or `none`                                      |
| `differsFromDefault`                            | Any semantic difference from the selected scenario's seeded model            |
| `dataChanged`                                   | Data/schema/document/array inputs differ from defaults                       |
| `queriesChanged`                                | Read patterns or write-rate inputs differ from defaults                      |
| `scaleChanged`                                  | Candidate cardinalities or scale inputs differ from defaults                 |
| `customizedContainerCount`                      | Current containers different from the default container at the same position |

Generated UI IDs, active-container selection, and wizard navigation do not count as changes. Names, ordered partition keys,
container ordering, additions/removals, and actual modeling inputs are compared locally, but their contents are never emitted.
Removing a trailing default container changes the model-difference flags without adding a removed item to the count of
customized **current** containers.

These current-difference flags are separate from `everEdited`, `dataEverEdited`, `queriesEverEdited`, and `scaleEverEdited`.
The latter describe interactions in this open panel. Reverting an edit can clear `differsFromDefault` while `everEdited`
remains true. A restored customized model can differ from defaults before any edits are made in the new panel.

## Viewed versus clicked tabs

Keep an in-memory set of viewed sections for each container. A section counts only when its container step is active and
the document is visible. The initially displayed Data tab counts as **viewed**, but not as **clicked**.

For each section (`data`, `queries`, `scale`):

```text
viewedCount     = number of current containers whose section was displayed
neverViewedCount = current containerCount - viewedCount
coverage         = viewedCount / current containerCount
```

Coverage is rounded to three decimal places and is zero for an empty model. Repeated visits do not increase the count.
Removed containers are excluded; new containers begin unviewed. Restoring saved work starts fresh visit tracking.
Container IDs remain local and are not included in telemetry.

Usage snapshots accompany milestones and the best-effort close summary. To answer "Did anyone ever click Scale?", count
`controlId = containerScaleTab`. To answer "How many modeled containers had Scale inspected?", use `scaleViewedCount` or
`scaleCoverage`. These are deliberately different questions.

## Recommendation quality, correlation, and feedback

- A random request ID travels through Chat and the report tool only for in-memory attempt matching. It is not persisted in
  the model or emitted as a telemetry property. Telemetry uses the ephemeral `panelId` and numeric `attemptNumber`.
- Superseded identified responses cannot overwrite a newer request. An accepted fresh result is counted/displayed once.
- Restored and legacy uncorrelated results are labeled separately and do not produce fabricated request-to-display latency.
- Requested/returned/matched/missing container counts and counts of missing candidates, risk analysis, routing, document-ID
  strategy, or guardrails describe completeness, not recommendation correctness.
- Thumbs feedback is recommendation-wide. Repeating the same vote is suppressed; switching is allowed. The choice survives
  wizard navigation, resets for a new recommendation, and is not persisted.
- Closing with a pending result, starting over, and superseding a request have distinct outcomes. There is no inferred AI
  timeout merely because a response was not observed.

### Model identity

The prompt asks the model to set `model` to its own identifier when it calls the report tool. The self-reported string is
**never** emitted. The host resolves it against the chat models published by VS Code (`vscode.lm.selectChatModels()`),
matching the normalized ID, then family, then name, and preferring Copilot-hosted models.

| Property      | Values                                                                     |
| ------------- | -------------------------------------------------------------------------- |
| `modelSource` | `matched`, `unmatched` (reported but not a published model), `notReported` |
| `modelId`     | Vendor-published `LanguageModelChat.id`, only when `matched`               |
| `modelFamily` | Vendor-published `LanguageModelChat.family`, only when `matched`           |
| `modelVendor` | Vendor-published `LanguageModelChat.vendor`, only when `matched`           |

These properties accompany `recommendationReceived`, report-tool failures in `recommendationOutcome` (`ai` and
`invalidResult`), fresh or uncorrelated `recommendationDisplayed`, `feedback`, and the close `summary`. They are cleared
for each new attempt and are not persisted, so restored results carry no model identity. The value is self-reported:
models can misidentify themselves, so treat it as a strong hint rather than ground truth. A missing or malformed value never
blocks delivery of the recommendation.

The Result page shows a muted "Generated by …" caption beside the feedback buttons. It uses the published model name when
matched, or the self-reported value otherwise. This display name is resolved by the host (a model-supplied `modelName` is
discarded), saved with the local result so restored results still show it, and never sent to telemetry.

## Privacy and limitations

Payloads are strictly allowlisted. No schema/document contents, property names, partition-key paths, queries, prompts, AI
prose, file names/paths, resource names, deployment code, or raw error messages are emitted by these feature events.
Input-heavy RPC telemetry remains suppressed; separate safe events use the existing extension telemetry pipeline and its
telemetry settings.

Visible-panel time is not active attention. Abrupt shutdown may prevent the close summary, so use milestone events as the
primary source for funnel analysis. Session-only "ever" counters describe one open panel, not a persistent user identity.

Implementation: [host tracker](../src/dataModeling/ModelingTelemetry.ts),
[allowlisted schemas](../src/dataModeling/modelingTelemetrySchema.ts),
[model comparisons](../src/dataModeling/modelingTelemetryMetrics.ts),
[wizard integration](../src/webviews/cosmosdb/DataModeling/DataModelingWizard.tsx).
