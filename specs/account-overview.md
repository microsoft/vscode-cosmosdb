# Account Overview: implementation specification

**Audience:** maintainers and coding agents. For product usage, read the
[user guide](../docs/account-overview-dashboard.md).

**Scope:** the Account Overview implementation in this repository, including the health-module extraction.
This is an as-implemented specification, not a roadmap or a claim that every described change has been released.
Requirements apply to the current implementation unless explicitly labeled **Known limitation** or **Not implemented**.
`MUST` identifies behavior to preserve; a deliberate behavior change requires updating this specification and its tests.
If code, tests and this document disagree, identify the discrepancy rather than silently choosing a new behavior.

## Contents

- [1. Vocabulary and ownership](#1-vocabulary-and-ownership)
- [2. Loading, refresh and navigation](#2-loading-refresh-and-navigation)
- [3. Metric calculations](#3-metric-calculations)
- [4. Inventory and partition distribution](#4-inventory-and-partition-distribution)
- [5. Health](#5-health)
- [6. Alerts and Azure Advisor](#6-alerts-and-azure-advisor)
- [7. Derived advisories](#7-derived-advisories)
- [8. Actions, permissions and feedback](#8-actions-permissions-and-feedback)
- [9. Verification contract](#9-verification-contract)
- [10. Known limitations and excluded work](#10-known-limitations-and-excluded-work)

## 1. Vocabulary and ownership

| Term                   | Exact meaning                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Account                | The Azure resource ID bound to the panel's host context. Header filters do not change this identity.                          |
| Chart scope            | Account, database, or the contract's database/container pair. The current header offers account/database scope only.          |
| Chart window           | `1H`, `24H`, or `7D`; controls displayed metrics, inventory RU peak and the selected partition distribution.                  |
| Diagnostic window      | A rule-specific interval independent of the chart window. See section 7.                                                      |
| Observation            | A sample with a valid timestamp and a finite numeric value in the requested aggregation field. Zero is an observation.        |
| Available              | A result-specific flag, not proof of complete account coverage. Successful empty alert lists differ from empty metric series. |
| Applicable             | Whether account metadata permits a metric, independently of observations, transport success and emission family.              |
| Account health         | Extension diagnostic severity, not Azure Resource Health, availability, provisioning status or a service-level objective.     |
| Row health             | One inventory container's diagnostic severity. It has different escalation rules from account health.                         |
| Active alert           | `monitorCondition = Fired`, regardless of incident workflow state.                                                            |
| Workflow state         | Azure `alertState`: New, Acknowledged or Closed. Separate from monitor condition.                                             |
| Recommendation         | Azure Advisor output.                                                                                                         |
| Derived advisory       | A finding computed by the extension's detector registry. Its High/Medium/Low severity is not account health.                  |
| Partition              | A physical partition. These views do not enumerate logical partition-key values.                                              |
| Capacity mode          | Serverless or Provisioned throughput. Manual/autoscale are offer modes within provisioned capacity.                           |
| Total throughput limit | Account-wide allocation cap; not consumed RU, reserved capacity or a performance measurement.                                 |

All Azure reads and writes run on the extension host using the bound account's Azure credentials.
The webview communicates through tRPC and MUST NOT acquire Azure tokens or perform Azure SDK calls.
Overview supports NoSQL inventory and its dependent diagnostics; unsupported API paths return structured unsupported results.

### Module responsibilities

Paths below are relative to `src/`.

| Module                                                          | Owns                                                                                                                        | Does not own                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `panels/accountOverview/overviewHealthModel.ts`                 | Pure base-health derivation, escalation, final health resolution, row fallback, semantic checklist outcomes and tab signals | Fetching, localization, React, Azure runtime clients          |
| `webviews/cosmosdb/AccountOverview/useOverviewHealthSignals.ts` | Account request-health and Fired-summary lifecycles, retained alert evidence, per-source sequencing, awaitable refresh      | Inventory, list filters, global Refresh, severity thresholds  |
| `webviews/cosmosdb/AccountOverview/AccountHealthStatus.tsx`     | Localized badge, checklist, health live status and tab explanations                                                         | Data acquisition or a second escalation policy                |
| `webviews/cosmosdb/AccountOverview/AccountOverview.tsx`         | Section coordination, shared filters, actions, navigation and global Refresh                                                | A duplicate health policy or separate alert-summary lifecycle |
| `panels/accountOverview/metrics/contracts.ts`                   | Metric keys, applicability and wire result types                                                                            | SDK acquisition or chart presentation                         |
| `panels/accountOverview/metrics/hostFetchers.ts`                | Metric queries, bucket merging, storage/document special cases                                                              | Localized labels                                              |
| `webviews/cosmosdb/AccountOverview/metrics/descriptors.ts`      | Labels, units, grouping and tile reduction                                                                                  | Azure metric names and collection                             |
| `panels/accountOverview/services/advisories/collect.ts`         | Evidence collection and per-rule coverage                                                                                   | Detector decisions                                            |
| `panels/accountOverview/services/advisories/engine.ts`          | Pure detector execution, supersession and ordering                                                                          | Azure calls, UI dismissals                                    |

The model's service DTO imports MUST remain type-only. Existing service exports of `deriveAccountHealth`,
`escalateAccountHealth` and `AccountHealthSignals` re-export the shared model for compatibility.
The hook's lifetime is identified by the **stable root tRPC client**, not `client.accountOverview`:
nested tRPC property access can create new proxies.

## 2. Loading, refresh and navigation

### Initial state

The default tab is Monitoring unless explicit navigation requests another destination.
Chart window defaults to `24H`; chart scope defaults to all databases.
The alert list defaults to `1d` and `Fired`. Partition selection defaults to the first inventory row.
Provisioned accounts initially select Normalized RU; confirmed Serverless accounts select Total request units.
Once a metric is explicitly selected, late metadata, Refresh and filter changes MUST preserve it.
Explicit navigation to an inapplicable metric displays its explanation rather than selecting a different metric.

There is no polling, refresh-on-editor-visibility, or automatic refresh timer.
Opening a panel starts initial reads even for sections on hidden tabs.
Switching tabs preserves filters, selection and local section state.

### Refresh dependency matrix

| Trigger                                       | Reads or state changes                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open panel                                    | Summary, inventory, all nine metric series, inventory metrics, account request health, Fired summary, alert list, Advisor, derived advisories; partition read once a container and applicability are known |
| Full Refresh                                  | All of the above; partition read only if a container is selected                                                                                                                                           |
| Change chart window                           | All metric series, inventory metrics, selected partition distribution                                                                                                                                      |
| Change database scope                         | All metric series only; Service availability remains account-scoped                                                                                                                                        |
| Change partition container or RU/Storage mode | Selected partition distribution only                                                                                                                                                                       |
| Change alert window or Active/Resolved        | Alert detail list only                                                                                                                                                                                     |
| Select metric, switch tab, return to editor   | No new data read solely for that event                                                                                                                                                                     |
| Successful database/container creation        | Inventory reload; not a full metric/health/advisory refresh                                                                                                                                                |
| Dismiss derived advisory                      | Add its ID to this mounted dashboard's dismissal set; no Azure write                                                                                                                                       |

**R1.** Full Refresh uses settled outcomes and waits for every scheduled section, even after a failure.
Concurrent full-Refresh invocations are suppressed. The two account signals are scheduled through one
`refreshHealthSignals()` call, not separately in nested refresh helpers.

**R2.** Trend, inventory, inventory-metric, partition and alert-list publication use latest-request guards.
The health hook has independent monotonic counters for account health and Fired summary.
An obsolete health response, error or `finally` MUST NOT overwrite current state or invoke the error callback.
Cleanup invalidates in-flight health publications; a root-client change clears retained health evidence.

**R3.** The health hook sets both loading flags during refresh and waits for both reads.
Its boolean result is true only if both operations fulfilled with true.
A structured unavailable Fired summary returns false except for `unsupported`; transport failures return false.
Transport failures call the current error callback; structured unavailable results are represented by their DTO state.
Changing callback identity alone MUST NOT trigger collection.

**R4.** Header controls are locked by explicit Refresh or pending trend, inventory-metric, account-health,
partition, alert-list, Fired-summary, Advisor or derived-advisory loading.
The spinner on Refresh represents explicit Refresh or a pending user header-filter update, not initial loading.
Locked header/alert selectors remain focusable but cannot activate or change selection.
Alert selectors remain locked until the entire full Refresh settles.

**R5.** Charts generated at is webview `Date.now()` when the latest accepted trend batch is published,
provided at least one result is available. It is absent when that batch has no available result.
It is not a metric DTO's `generatedAt`, the latest Azure sample timestamp, an ingestion timestamp
or the freshness of every section.

**R6.** Explorer navigation reuses the existing panel, closes advisory dialogs/open selectors for a new explicit
navigation revision, and preserves data filters. Generic navigation focuses the destination tab;
metric navigation selects the metric and focuses its chart region. A replayed revision or background completion
MUST NOT refocus the view or dismiss a dialog.
Metric navigation MUST wait for the requested selection to commit before focusing the chart, including when
an inapplicable metric resolves to consumed RU, so the focus event exposes the destination's name and content.

## 3. Metric calculations

Sources: [contracts](../src/panels/accountOverview/metrics/contracts.ts),
[host fetchers](../src/panels/accountOverview/metrics/hostFetchers.ts),
[shared sample helpers](../src/panels/accountOverview/services/shared.ts),
[presentation descriptors](../src/webviews/cosmosdb/AccountOverview/metrics/descriptors.ts).

### 3.1 Windows, observations and reduction

Chart presets are `1H = 1 hour/PT1M`, `24H = 24 hours/PT5M`, `7D = 7 days/PT1H`.
The actual query interval is the coarser of the preset and the metric's minimum supported interval.
Each host query ends at its own collection time; Refresh does not establish a transactional cross-source snapshot.

`Maximum`, `Average`, `Total` and `Count` read only `maximum`, `average`, `total` and `count`, respectively.
No fallback to another aggregation field is permitted. Missing/null/non-finite values are skipped.
The shared timestamp parser skips invalid timestamps; the document-count fetcher has a legacy exception noted below.
Generic same-timestamp collisions sum for Total/Count and take maximum for Maximum/Average.
In particular, merging Average series is **not** a sample-weighted average.
Generic points are sorted by timestamp; peak is the largest observed bucket.

| Key / visible label                              | Azure metric and aggregation                                                                        | Minimum interval | Tile reduction                                | Family   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------- | -------- |
| `normalizedRu` / Normalized RU                   | `NormalizedRUConsumption`, Maximum                                                                  | PT1M             | Peak                                          | State    |
| `totalRequests` / Total requests                 | `TotalRequests`, Count                                                                              | PT1M             | Sum of buckets                                | Activity |
| `totalRequestUnits` / Total request units        | `TotalRequestUnits`, Total                                                                          | PT1M             | Sum of buckets                                | Activity |
| `metadataRequests` / Metadata requests           | `MetadataRequests`, Total                                                                           | PT1M             | Sum of buckets                                | Activity |
| `serverLatency` / Server-side latency            | `ServerSideLatencyDirect` and `ServerSideLatencyGateway`, Average; maximum of the two per timestamp | PT1M             | Peak of merged averages                       | Activity |
| `serviceAvailability` / Service availability     | `ServiceAvailability`, Average; always account-scoped                                               | PT1H             | Latest observed value                         | Activity |
| `dataIndexUsage` / Data + index usage            | `DataUsage` and `IndexUsage`, Maximum; component rules below                                        | PT5M             | Latest observed bucket's available components | State    |
| `provisionedThroughput` / Provisioned throughput | `ProvisionedThroughput`, Maximum                                                                    | PT5M             | Latest observed value                         | State    |
| `documentCount` / Document count                 | `DocumentCountV2`, Maximum; collection snapshot rules below                                         | PT5M             | Latest combined snapshot                      | State    |

Total request units is a volume in RU over the window, not RU/s. Provisioned throughput is RU/s.
Normalized RU is already a percentage; MUST NOT divide it by provisioned throughput.
Its 100% reference is a percentage ceiling, not a second RU/s series.
Latency is server-side, not end-to-end latency or a latency percentile.
Latest means the last **observed** value, not a claim that Azure has a sample for the current instant.

The UI groups applicable tiles State then Activity, preserving descriptor order within each group.
Inapplicable tiles are omitted. Family affects presentation, not applicability or health.
Formatting rounds percent/ms to integers, count/RU values compactly, and byte values with binary divisors
1024/1024²/1024³ despite the current KB/MB/GB labels. Comparisons operate on unrounded values unless specified otherwise.

### 3.2 Applicability and unavailable states

Confirmed Serverless metadata makes only `normalizedRu` and `provisionedThroughput` not applicable.
Their router returns a structured reason before Monitor-client acquisition/query.
The UI omits their tiles, inventory throughput/normalized-RU columns and throughput-mode filter.
The header omits the provisioned-throughput cap. Inapplicable chart links select consumed RU instead.
If metadata removes a focused tile, focus moves to the selected applicable tile without stealing focus from another editor.
An account throughput cap, absent metric data or failed request MUST NOT establish Serverless.
Unknown capacity metadata yields unknown applicability, not not-applicable.

| State                                 | Required interpretation                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| Observed zero                         | Render 0 in the metric's unit                               |
| `available: false`, `reason: noData`  | No usable observations/result; not evidence of good health  |
| `applicability.status: notApplicable` | Omit the metric tile, table column and associated controls  |
| `reason: rbac`                        | Permission-related failure                                  |
| `reason: unsupported`                 | An explicitly unsupported source/API                        |
| Metric `reason: error`                | Request failed; distinct from a successful empty query      |
| Loading                               | Pending operation; not an observation or a proof of absence |

Metric fetchers, storage components and account request-health use `metricFailureReason`: recognized 403/Forbidden/
AuthorizationFailed becomes `rbac`, other caught failures become `error`.
Legacy `classifyUnavailable` instead maps non-permission errors to `noData`; alerts, Advisor and some advisory paths
still use it. The spec MUST NOT imply that every `noData` in every DTO proves a successful empty Azure query.

A failed metric request replaces only its tile's result. A chart batch MUST retain other successful metrics.
For the generic latency fetcher, failure of either metric-name query fails that tile; storage has independent partial reads.

### 3.3 Storage

Each data/index component is either `{status: available, bytes, timestamp}` or
`{status: unavailable, reason}`. A storage summary is:

1. Both components available: complete, bytes = data + index.
2. Exactly one available: partial, bytes = the available component.
3. Neither available: unavailable, no numeric total.

**Monitoring:** queries use the selected window/scope. Components match only at an identical timestamp.
`MetricPoint.value` exists only for a complete total at that timestamp; component observations remain on partial points.
The Data and Indexes chart series are independent, solid and dashed respectively.
No interpolation/forward-fill of a missing component is permitted.
If consecutive observed timestamps are more than one effective bucket apart, the host inserts an empty point at
`previous timestamp + bucketMs` to break both lines. It does not synthesize every missing bucket.
The tile uses components at the newest observed timestamp, even if an older point had a complete total.
Point tooltips expose component values/reasons; an entirely unavailable component has a legend explanation.

**Inventory:** each container uses the latest available data observation and latest available index observation
over seven days at hourly grain; their timestamps may differ.
The inventory total can therefore differ from Monitoring's timestamp-aligned total.
Data growth is `last DataUsage - first DataUsage` within that seven-day series, not index growth,
not percentage growth and not a projection. Fewer observations do not imply a full seven-day history;
one observation produces a zero difference. Sparklines retain at most 24 sampled values including endpoints.

If `getMonitorClient()` returns undefined, inventory returns no metric rows and both `storageFallback` components
have reason `error`; the legacy top-level reason remains `noData`. Storage explanations MUST use the component
reasons so client initialization failure is shown as Unable to load, not No data.

**Known limitation:** generic Monitoring storage uses unsplit scope queries and maximum collision merging.
It is not a canonical sum of all per-container snapshots; do not claim inventory/account-storage reconciliation.

### 3.4 Documents

Document count is a gauge, not a request counter. Split `DocumentCountV2` by database/container.
For each collection/timestamp, fold replicas with maximum rather than sum.
Walk the union of observed timestamps; forward-fill each collection's last observed value, then sum collections
that have an observation by that time. Do not invent a value before a collection's first observation.
The tile is the last resulting snapshot, not the sum of snapshots across the chart window.
Inventory uses each container's latest observed gauge over its seven-day collection window.
These counts remain best-effort: no observation for a collection means it cannot contribute to the total.
**Known limitation:** the document-count fetcher currently parses timestamps directly with `new Date(...).getTime()`
rather than the shared validity guard, groups missing collection metadata under an empty key, and does not inspect
per-metric `errorCode` fields. Do not infer identical malformed-response handling from the generic fetcher.

### 3.5 Sustained-throttling algorithm

The shared bucket algorithm uses `TotalRequests`, Count, split by `StatusCode` plus the caller's scope.
For each valid timestamp, sum all statuses into `total`; only the exact status string `429` contributes to `throttled`.
A bucket qualifies when `total > 0` and `throttled / total > 0.01` (**strictly greater**, not greater-or-equal).
Sort qualifying timestamps and split runs whenever the gap exceeds `1.5 * bucketMs`.
A run qualifies when `lastTimestamp - firstTimestamp + bucketMs >= 5 minutes`.
Mark every qualifying timestamp in such a run.

Account/row health use a separate one-hour, one-minute request query.
Normalized RU and Total requests chart overlays instead use the chart's scope/window/grain and only mark
timestamps present in the primary series. A failed overlay keeps the primary series without bands.
Thus one five-minute/hourly qualifying bucket can satisfy the chart-overlay duration test, while account health
still needs the corresponding run in its minute-grain query. Overlay absence MUST NOT certify zero throttling.
The seven-day derived-advisory 429 rate is another calculation: total 429 counts / total request counts over the
whole diagnostic window, with a default **greater-or-equal 1%** gate, plus the rule's other gates.

## 4. Inventory and partition distribution

Sources: [inventory](../src/panels/accountOverview/services/inventory.ts),
[inventory metrics](../src/panels/accountOverview/services/inventoryMetrics.ts),
[partition calculations](../src/panels/accountOverview/services/partitionHealth.ts),
[inventory UI](../src/webviews/cosmosdb/AccountOverview/InventoryTable.tsx).

### Inventory

ARM enumeration records databases, containers, indexing exclusions and actual throughput offers.
Shared database offers are distinct from dedicated container offers; an autoscale maximum is not a manual reservation.
Empty databases remain available to account actions even though the table consists of container rows.
Throughput enumeration has no resumable cursor exposed to the webview.

Inventory metrics make account-level queries split by `DatabaseName`/`CollectionName`, not one request per row.
RU peak uses the selected chart window; storage/documents use seven days; sustained 429 uses one hour.
Serverless skips normalized-RU collection. Index, document and 429 observations can survive data/RU collection failure.
Top-level `available` is false after a primary DataUsage/RU query failure or if there are no container keys;
the `metrics` map can nevertheless contain usable independent results.

Search/filtering precedes sorting and pagination. Critical rows sort before non-Critical rows in either sort direction;
the chosen column/direction sorts within those groups. Pagination is 25 rows, zero-based internally.
The viewport shows roughly five rows before internal scrolling; all rows on the page remain mounted in a native table.
Sorting/filtering resets to page one; shorter results clamp the current page; tab changes preserve it.
Header database scope does not filter health aggregation over inventory.

### Partition distribution

The selected container is independent of the header's database scope.
Serverless forces Storage on the host even if an older caller requests RU; the UI hides the RU/Storage toggle.
Provisioned accounts keep both modes. Missing storage remains no-data/error, not not-applicable.
The selected chart window controls the interactive distribution; derived rules use their own windows.

**RU mode:** query Maximum `NormalizedRUConsumption` split by `PhysicalPartitionId`.
For each partition compute p99 using linear interpolation at rank `0.99 * (n - 1)` on sorted finite samples.
The displayed percent is that partition's p99 utilization, **not its fraction of total account RU**.
With defaults, the container is hot/skewed when there are at least two partitions,
maximum p99 >= 90 and minimum p99 < 70.
Only partitions with p99 >= 90 in such a container get a hot flag.
Uniform saturation is not skew and does not light hot tiles, even though it can support an under-provisioning advisory.

**Storage mode:** take each partition's peak size over the selected window.
Let `v_i = max(0, peak_i)`, `total = sum(v_i)`, `coolest = min(v_i)`.
The displayed share is `100 * v_i / total`, or zero if total is zero.
Flag a tile only with at least two partitions, `v_i >= 1 GiB`, and `coolest / v_i < 0.7`.
The peaks need not be simultaneous; the view is not a point-in-time physical-storage snapshot.

Tiles sort descending by displayed value then partition ID. The ranked list defaults to five.
A hot tile is intensity 5; other intensities are `clamp(1 + floor(4 * excess), 1, 4)`,
with non-finite/non-positive excess mapped to 1.
RU excess is p99/saturation threshold. Storage excess is
`(1 - coolest/value) / (1 - balanceThreshold)` for a balance threshold strictly between 0 and 1.
RU `skewScore` is the maximum over timestamps of `100 * max(positive values) / sum(positive values)`;
storage `skewScore` equals the largest storage share. Neither is an account-health input.

## 5. Health

Sources: [pure model](../src/panels/accountOverview/overviewHealthModel.ts),
[request-health collection](../src/panels/accountOverview/services/accountHealth.ts),
[signal hook](../src/webviews/cosmosdb/AccountOverview/useOverviewHealthSignals.ts),
[presentation](../src/webviews/cosmosdb/AccountOverview/AccountHealthStatus.tsx).

### 5.1 Base, escalation and final display

The known-state order is Healthy < Needs Attention < Critical. Unknown is absence of health evidence, not rank zero.
Base health is evaluated in this order:

1. Sustained account-wide throttling OR provisioning Failed/Canceled: Critical.
2. Provisioning Creating/Updating/Deleting: Needs Attention.
3. Usable account-wide request observations: Healthy.
4. Otherwise: undefined, displayed as Unknown.

The request query has no database/container filter and no inventory dependency.
Observed zero counts permit Healthy in step 3. `Succeeded` alone does not.

Apply the following signals with a maximum operation; escalation MUST NOT downgrade a known base.
If no base exists, an adverse signal can establish its severity. No adverse signal plus no base stays Unknown.

| Signal                                                                     | Minimum aggregate severity | Tab source severity                       |
| -------------------------------------------------------------------------- | -------------------------- | ----------------------------------------- |
| Account sustained 429                                                      | Critical                   | Monitoring: Critical                      |
| At least one Fired Sev0/Sev1 alert                                         | Critical                   | Advisories: Critical                      |
| At least one Fired Sev2/Sev3 alert                                         | Needs Attention            | Advisories: Needs Attention               |
| Available Advisor result containing High-impact Performance or Cost        | Needs Attention            | Advisories: Needs Attention               |
| At least one Critical inventory container                                  | Needs Attention            | Databases and Containers: Critical        |
| Warning-only inventory containers                                          | No account escalation      | Databases and Containers: Needs Attention |
| Informational alerts, other Advisor categories/impacts, derived advisories | No account escalation      | No health indicator from these inputs     |

The final badge also resolves against the header's provisioning state, keeping the higher known severity.
If the latest Fired-summary check is unavailable and the resolved result would be Healthy, display Unknown.
Known Critical/Needs Attention survives this failure. Missing Advisor/container checks alone do not suppress Healthy.
Therefore Healthy is **not** a statement that all checklist checks passed.
Provisioning can appear in Account details without a warning triangle on any tab.

### 5.2 Retained evidence and row fallback

Starting a health refresh retains previous results while showing Checking.
An account request-health transport rejection clears that account result; a structured result replaces it.
A failed/unavailable Fired summary retains the previous summary if one exists and marks it stale.
A successful summary replaces it, including zero counts, which can clear old alert signals.
Stale adverse alerts continue to drive account and tab severity.
Alert-list filters/results MUST NOT clear or replace the independent Fired summary.

The table labels its row diagnostic **Throttling**, not overall Health, and renders internal Healthy as **Passed**.
Provisioned metric row health: sustained row 429 OR peak RU >= critical threshold -> Critical;
otherwise peak RU >= warning threshold -> Needs Attention; otherwise an observed RU peak -> Healthy;
otherwise undefined. Serverless ignores normalized RU: sustained row 429 -> Critical; observed requests without
sustained 429 -> Healthy; missing observations or a failed request read -> undefined.
Default critical/warning thresholds are 90/80, independently configurable.
Both modes use the sustained-throttling share/duration policy in §3.5 over the last hour.
Observed zero Count buckets are evidence; empty/null/invalid buckets are not.
`ContainerMetrics.throttled` is true/false only with usable per-container request observations; otherwise it is absent,
with `throttlingReason` distinguishing noData, rbac and error. Embedded metric errors are failures, not clear checks.
Embedded errors retain their service code for permission classification. `throttlingFallbackReason` carries the
request-check outcome to rows absent from the metric snapshot, including when every Monitor read failed.
The fallback is independent of storage/RU failure reasons; successful reads without request observations use noData.
Storage growth and consumed RU do not participate.

The shared `rowHealth` display fallback is intentionally more specific:

| Input                                                | Display/aggregation health                     |
| ---------------------------------------------------- | ---------------------------------------------- |
| Metric object exists and has health                  | That health                                    |
| Metric object exists without health                  | Unknown                                        |
| No metric object and normalized RU is not applicable | Unknown                                        |
| No metric object otherwise                           | Inventory row's existing static `health` value |

The final fallback can display a provisioned row as Passed (internal Healthy) without observations.
This is a **known compatibility limitation**, not evidence to generalize into a missing-data policy.
The container checklist independently counts rows with no metric health as unassessed.

### 5.3 Checklist precedence

The badge has one polite health status output and a keyboard-focusable description when explanatory text exists.
Visible health text and its accessible name derive from the same localized label.
Check descriptions interpolate diagnostic-policy thresholds/durations; they do not maintain separate constants.
Provisioning is prepended by presentation to the model's four checks.

| Check            | Outcome precedence, first matching condition wins                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provisioning     | Succeeded -> Passed; Failed/Canceled -> Critical; Creating/Updating/Deleting -> Needs Attention; absent -> Not assessed                                       |
| Account requests | Loading -> Checking; sustained 429 -> Critical; available -> Passed; otherwise Not assessed                                                                   |
| Containers       | Any Critical -> Needs Attention; loading -> Checking; unsupported/unavailable inventory or any unassessed row -> Not assessed; otherwise Passed               |
| Fired alerts     | Loading -> Checking; stale/unavailable/absent summary -> Not assessed; critical count > 0 -> Critical; warning count > 0 -> Needs Attention; otherwise Passed |
| Advisor          | Loading -> Checking; unavailable/absent result -> Not assessed; qualifying recommendation -> Needs Attention; otherwise Passed                                |

Checklist details may describe retained evidence while the outcome is Checking.
Warning-only rows can coexist with a Passed container checklist and a yellow tab indicator.
An available empty inventory has no unassessed rows and yields Passed for its container check.
These are current precedence rules, not synonyms for “every resource is healthy.”

The badge explicitly excludes HTTP 5xx, service availability, latency, storage limits and index health.
Displaying those metrics or findings elsewhere MUST NOT silently add them to aggregate health.

## 6. Alerts and Azure Advisor

Source: [alerts/recommendations service](../src/panels/accountOverview/services/alertsRecommendations.ts).

### Alert list

`getAlerts` iterates Alerts Management `alerts.getAll` under subscription scope with `targetResource = account ID`,
the selected Azure `timeRange` and selected `monitorCondition`.
Windows are `1h`, `1d`, `7d`, `30d`; Active maps to Fired and Resolved maps to Resolved.
Each window displays the Resource Graph aggregate for the selected condition. Counts are based on alert start time,
not resolution time; windows are cumulative lookbacks. Retention is 30 days, not 90.
Switching filters announces the matching aggregate rather than counting loaded detail rows.
Unavailable/stale aggregate checks display a dash and announce count unavailability, not zero.
Each load queries only the selected condition. No All or workflow-state filter exists.
Failures replace stale list rows with an unavailable result; they do not erase retained account-wide health evidence.
An available empty list means no returned matches for these Azure filters, not no account-wide alerts.

Severity mapping is exact: Sev0/1 -> Critical; Sev2/3 -> Warning; everything else -> Informational.
List ordering is severity then descending start time, with missing start time treated as zero.
The DTO retains raw severity, monitor condition and workflow state. No state is modified by Overview.

### Account-wide Fired summary

One Resource Graph POST targets the account's configured Resource Manager endpoint,
`/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01`, using the existing authenticated ARM pipeline.
The request limits subscriptions to the bound subscription, sets object-array results and `allowPartialScopes: false`.
Its `alertsmanagementresources` query filters case-insensitively by alert resource type and exact target account ID.
It computes total, Sev0/1 and Sev2/3 counts using Fired-only `countif` expressions without a time restriction.
The same query also computes Fired/Resolved counts for every supported window with start-time predicates.
There is no workflow-state predicate. No alert instances are downloaded to compute counts.

The parser accepts exactly one aggregate row, one total record, no continuation token, no truncation,
and non-negative integer counts; critical + warning must not exceed total. All period/condition counts must be present,
monotonic across expanding windows, and Fired counts must not exceed the account-wide total.
Malformed/non-success responses become unavailable, not a successful zero-count summary.
Successful counts mean all retained results visible through this query, not an unbounded incident history.
Azure retention, RBAC and Resource Graph propagation can omit or delay evidence.

A Closed-but-Fired alert currently still contributes. A Resolved-but-New alert does not.
No dedicated notification of unclosed active incidents exists.
The list's period never determines the badge count; the portal maintains its own filters.

Account Alerts links remain usable after query failures.
Alert details use `AlertDetails.ReactView` and double-encode the full alert ID as a single route parameter.
Account Alerts uses `AlertsSummaryBlade` and double-encodes the full account ID as its `resourceId` route parameter.
Both IDs remain a single parameter after VS Code's external opener serializes the URI.
Portal URLs use the subscription's configured portal base and tenant; do not guess the cloud from a tenant ID.

### Advisor

There is one subscription-wide `recommendations.list()` iteration, cached by subscription ID for 55,000 ms from
request start. Callers within the TTL share the promise; a rejected cached promise is evicted.
Full Refresh invokes the read but does **not** bypass this cache or force Azure Advisor to recompute recommendations.
This cache does not implement polling.

Filter recommendations to case-insensitive account resource ID equality or the `accountId + "/"` descendant prefix.
Omit recommendations without problem text. Normalize unknown impact to Low.
Sort High/Medium/Low then category. Health qualification requires exact category Performance/Cost and impact High.
Azure recommendation prose and links remain Azure-authored; DTO normalization means the payload is not literally verbatim.
Derived advisories do not substitute for unavailable Advisor evidence.

## 7. Derived advisories

Read [the collector](../src/panels/accountOverview/services/advisories/collect.ts) when changing acquisition,
[the registry](../src/panels/accountOverview/services/advisories/registry.ts) when adding/removing rules,
and [diagnostic policy](../src/panels/accountOverview/services/advisories/core/thresholds.ts) when changing thresholds/windows.
Rule implementations are in [detectors](../src/panels/accountOverview/services/advisories/detectors).

### 7.1 Evidence and policy

The collector independently enumerates authoritative offers; it does not reuse a filtered/paged UI inventory.
Dedicated means an actual container-level offer with positive throughput.
Manual-only and autoscale-only rules use that offer's mode, not a database's copied RU value.
Account capacity materiality sums offers once, including database-level shared offers.
Container worker batches are size five; a worker may issue multiple source requests concurrently.
This is not a global limit of five HTTP requests for the entire collector.

Autoscale utilization queries Maximum `AutoscaledRU` split by physical partition, sums returned values at each
timestamp, and multiplies by `100 / configuredMaxRu`. Peak and arithmetic mean of those percentages feed AO-D14/15.
It is not normalized RU divided by the configured max. The Serverless-candidate shape sums account
`TotalRequestUnits` Total collisions per timestamp, divides each bucket by 3,600 seconds, then takes peak/mean
over observed hourly buckets. Missing buckets do not become zero samples in either calculation.

| Evidence                            | Window / grain                           | Live collector targets                                                |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| Manual normalized RU                | 30 days / 1 hour                         | Dedicated manual containers                                           |
| Idle consumed RU, Total             | 30 days / 5 minutes                      | Dedicated manual/autoscale containers                                 |
| Partition p99 + request-rate totals | 7 days / 1 hour                          | Dedicated containers                                                  |
| Partition storage for growth        | 30 days / 1 hour                         | Dedicated containers                                                  |
| Partition storage for skew          | 7 days / 1 hour                          | Dedicated containers                                                  |
| Index/data storage                  | Inventory's 7-day component observations | Inventory rows, only if advisory inventory-metric result is available |
| Partition count and DataUsage peaks | 6 hours / 5 minutes                      | Dedicated containers, explicit database/container queries             |
| AutoscaledRU                        | 30 days / 1 hour                         | Dedicated autoscale containers                                        |
| Consumed-RU shape                   | 30 days / 1 hour                         | Non-Serverless account, no database filter                            |
| Serverless request-rate totals      | 7 days / 1 hour                          | Serverless containers                                                 |
| Log query fan-out evidence          | Last 24 hours, raw event aggregation     | Dedicated and Serverless containers                                   |
| Log ingestion evidence              | Last 24 hours, raw event aggregation     | Dedicated containers                                                  |
| Log shared-pool evidence            | Last 24 hours, raw event aggregation     | Shared-throughput database offers                                     |

Idle/merge queries MUST target known containers, not discover them through wildcard metric series or a larger `top`.
Missing idle peak or missing either merge count/storage excludes that input and records coverage failure.
Failed checks preserve findings from successful checks and configuration-only inputs.
The result exposes metric and log coverage separately. An empty finding list does not prove full coverage.
Some empty successful sources abstain via sample gates without marking a failure; coverage flags are not a
complete inventory of every insufficient-evidence case.

Known age below a rule's minimum suppresses that rule; unknown/non-finite age does not.
Collector age derives from resource/offer creation metadata with account creation as fallback.
Manual/autoscale utilization rules require at least 24 finite observations; this is not 24 days or complete coverage.

Runtime settings are read by [router threshold preparation](../src/panels/trpc/routers/accountOverview/thresholds.ts).
The tables below state defaults. Only the registered setting subset is configurable.
Health thresholds use nullish fallback; partition saturation/headroom/skew require positive overrides,
and partition `topN >= 1` is floored. Advisory overrides accept non-negative values.
Consequently an explicit zero can differ between heatmap and advisory settings; do not promise equality for zero overrides.
The header sustained-429 policy is independent of `advisories.throttleRatePercent`.

### 7.2 Rule predicates and severity

All predicates in one row are AND unless the row explicitly says OR.
“Rate” is `100 * sum(429 counts) / sum(all counts)`, zero for a zero denominator.
`p99` uses the interpolation in section 4. `avg` is arithmetic mean of observed samples.
`M` is the capacity-materiality function defined after the table.
AO-D identifiers preserve the previous dashboard-document taxonomy; AO-D1 is health and AO-D8 is Azure passthrough,
not entries in the derived-detector registry.

| ID / rule                                     | Predicate on collected input, default thresholds                                                                                                                                   | Severity                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| AO-D2 `HotPartitionRisk` / DX-006             | Age not known <1 day; >=2 partitions; max p99 >=90%; min p99 <70%                                                                                                                  | High if rate >=1%; otherwise Medium                                  |
| AO-D4 `SustainedThrottlingInRegion` / DX-005  | Age not known <1 day; >=1,000 requests; rate >=1%; max p99 >=90%; min p99 >=70%                                                                                                    | High rate >=20%; Medium >=5%; otherwise Low                          |
| AO-D5 `OverProvisioning` / DX-001             | Dedicated manual; age not known <7 days; >=24 samples; p99 <30%; peak <90%                                                                                                         | M(recoverable RU/s)                                                  |
| AO-D6 `AutoscaleCandidate` / DX-012           | Dedicated manual; same age/sample gates as AO-D5; avg >0; peak >=40%; avg <=30%; peak/avg >=5                                                                                      | Medium                                                               |
| AO-D7 `IndexingCostRisk`                      | Data >0; index >=0; no user exclusions; index/data >0.3                                                                                                                            | Low                                                                  |
| AO-D9 `StorageGrowthRisk` / DX-017            | At least one material partition already >=50 GiB OR projected to 50 GiB within <=180 days; detailed rules below                                                                    | High <=30 days, Medium <=90, otherwise Low; already at limit is High |
| AO-D10 `ExpensiveConsistency` / DX-016        | >=2 regions; normalized consistency Strong or Bounded Staleness                                                                                                                    | Strong: Medium; Bounded Staleness: Low                               |
| AO-D11 `MultiRegionWriteAntipattern` / DX-008 | Multi-write enabled, then first match: Cassandra/Graph/Table API; else <2 write regions; else positively classified non-production                                                 | High; Low; Medium respectively; otherwise absent                     |
| AO-D12 `IdleContainer` / DX-004               | Dedicated manual/autoscale; positive offer; age not known <7 days; observed maximum consumed RU per 5-minute bucket <=50                                                           | M(full manual RU/s or 10% autoscale max)                             |
| AO-D13 `PartitionMergeCandidate` / DX-009     | Observed rounded actual partition count >=2 and >needed; needed defined below                                                                                                      | Medium if actual >=2*needed; otherwise Low                           |
| AO-D14 `AutoscaleMaxOverProvisioned` / DX-011 | Autoscale configured max >0; age not known <7 days; >=24 samples; peak AutoscaledRU percentage <30% and <90%                                                                       | M(recoverable floor RU/s)                                            |
| AO-D15 `AutoscaleToManualCandidate` / DX-013  | Autoscale; same age/sample gates; avg >0 and >=66% of configured max; peak/avg <=1.3                                                                                               | Medium                                                               |
| AO-D16 `ServerlessCandidate` / DX-014         | Not Serverless; >=24 hourly samples; peak RU/s in **[10, 5000]**; avg/peak <0.1                                                                                                    | Low                                                                  |
| AO-D17 `CrossPartitionQuery` / DX-002         | >=50 observed executions; inferred partition count >1; >=10% executions belong to shapes with avg fan-out >=1.5                                                                    | High share >=30%; otherwise Medium                                   |
| AO-D18 `ShardKeyMisalignment` / DX-007        | >=50 executions; inferred partitions >=2; fan-out execution share rounded to one decimal >=60%                                                                                     | High rounded share >=80%; otherwise Medium                           |
| AO-D19 `UncontrolledIngestion` / DX-010       | >=1,000 requests; write RU/total RU >=80%; rate >=10%                                                                                                                              | High rate >=20%; otherwise Medium                                    |
| AO-D20 `SharedThroughputStarvation` / DX-003  | >=2 collections each with >=100 requests; among those collections pool rate >=5%, total RU >0, largest RU share >=60%, and a different collection has rate >=5% and RU share <=20% | High                                                                 |
| AO-D21 `ServerlessThrottling` / DX-018        | Serverless container; >=1,000 requests; rate >=1%; no normalized-RU prerequisite                                                                                                   | High rate >=20%; Medium >=5%; otherwise Low                          |
| AO-D3 `StorageSkewRisk` / DX-015              | Age not known <1 day; >=2 valid non-negative partition peaks; busiest >=1 GiB; coolest/busiest <0.7                                                                                | High busiest >=40 GiB; Medium >=25 GiB; otherwise Low                |

**Capacity materiality M:** with positive known account offer total, High if recoverable/total >=5%,
Medium if >=1%, otherwise Low. Without that total, High if recoverable >=5,000 RU/s,
Medium if >=1,000 RU/s, otherwise Low. These are capacity heuristics, not money saved.

**Right-sizing formulas:** let P be current offer RU/s, C99=P*p99/100 and Cpeak=P*peak/100.
Manual recommended RU is `min(P, max(400, ceil(1.3*C99), ceil(Cpeak)))`; recoverable is `max(0, P-recommended)`.
Autoscale max recommendation is `min(P, max(400, ceil(1.3*Cpeak), ceil(Cpeak)))`;
recoverable floor is `max(0, max(400, 0.1*P) - max(400, 0.1*recommended))`.
Manual-to-autoscale suggested max is `max(1000, ceil(1.3*Cpeak/1000)*1000)`.
These outputs are guidance, not an ARM-validated legal target or a change operation.
The current over-provisioning rules can emit a finding with zero recoverable capacity, including 400 -> 400 RU/s.

**Merge:** `needed = max(ceil(offer RU/10000), ceil(DataUsage peak/(50*1024^3)), 1)`.
The storage input is DataUsage only, not the UI's data-plus-index sum.
The live collector requires both count and storage observations even though the pure evaluator has optional-field fallbacks.

**Storage growth:** use the newest valid sample per partition for current bytes, not its peak.
Ignore partitions smaller than 1 GiB. Current >=50 GiB wins immediately, even with flat/shrinking history.
Otherwise fit ordinary least-squares bytes/day:
`slope = sum((day-meanDay)*(bytes-meanBytes)) / sum((day-meanDay)^2)`.
Require at least two finite samples at distinct times and slope >=0.1 GiB/day.
Projection is `(50*1024^3 - currentBytes)/slope`. Choose the soonest qualifying partition per container;
already-at-limit partitions take precedence, with the largest current size breaking that case's tie.
The horizon comparison is inclusive. This is not a container-wide storage limit or a growth-based health input.

**Index exclusions:** ignore only exact root strings `/_etag/?` and `/"_etag"/?` when counting exclusions.
Nested `_etag`, differently cased, other paths and unknown path entries are not implicitly system exclusions.
This is an index-storage proxy, not a measurement of write RU spent maintaining indexes.

**Environment classification:** AO-D11 uses `classifyEnvironment` in
[environmentClassifier.ts](../src/panels/accountOverview/services/environmentClassifier.ts), including its ordered
tag keys, synonym map and name patterns. These tables are part of the rule, not a free-form substring heuristic.
Unknown classification does not establish non-production; the explicit API and write-region branches precede it.

### 7.3 Log semantics, output and supersession

Log reads use `LogsQueryClient.queryResource` with the account resource ID, not a user-selected workspace ID.
Required resource-specific tables are `CDBQueryRuntimeStatistics` and `CDBDataPlaneRequests`.
Legacy AzureDiagnostics schemas are not supported. A missing required table is reported as
`logAnalyticsDisabled`; this legacy name does not prove diagnostic settings are disabled.
An SDK partial-query failure excludes that query's evidence rather than treating partial tables as a complete result.
Independent probes/queries can still provide successful findings.

Query fan-out groups `dcount(PartitionKeyRangeId)` by correlated activity ID and query text,
then aggregates execution count/average/max fan-out per query shape and takes the 200 most frequent shapes.
Execution shares and inferred partition count are therefore based on those returned shapes;
“inferred partitions” is maximum observed fan-out, not an ARM partition inventory.
The strongest query shape is the qualifying shape with the most executions.
Ingestion write RU sums RequestCharge for exact operations Create, Upsert, Replace, Delete, Patch, Batch and Execute.
Total RU sums all operations; request/429 counts use event count and `StatusCode == 429`.
Burst factor is peak/mean of observed one-minute write-RU totals, or zero when the mean is zero;
the dominant client is the UserAgent with the most write events.
Burst factor and client are supporting evidence, not additional firing thresholds.
Nevertheless the current fetcher waits for all three summary/burst/client queries and rejects its input if any fails.
Shared-pool percentages exclude collections below the minimum-request gate.

The engine evaluates every registered detector, marks superseded findings by matching rule and scope,
and sorts High/Medium/Low, then rule, then scope.
Supersession relationships:

- `AutoscaleCandidate` supersedes `OverProvisioning`.
- `IdleContainer` supersedes `OverProvisioning` and `AutoscaleMaxOverProvisioned`.
- `ShardKeyMisalignment` supersedes `CrossPartitionQuery`.

The engine returns marked findings; the UI hides superseded and locally dismissed IDs.
Dismissals survive Refresh in the mounted dashboard, are not Azure dismissals and are not persistent across remounts.
Grouped guidance precedes per-resource details; each finding remains individually dismissible.
Backtick-delimited evidence is parsed as text emphasis, not HTML/general Markdown; resource text is escaped before interpolation.
Rendered rationale is capped at 500 characters by the existing helper.

### 7.4 External references

CODA commit `53d43cec4e46885d8610751e24d937bc794a4550` is the historical comparison baseline for DX identifiers:
[azure-data-database-platform/coda](https://github.com/azure-data-database-platform/coda).
It does not override this repository's predicates, collector coverage or acceptance criteria.
The older AO-D numbering includes UI health and Azure passthrough, so it is not a detector count.
Policy motivation includes [partitioning](https://learn.microsoft.com/azure/cosmos-db/partitioning),
[autoscale](https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale) and
[serverless performance](https://learn.microsoft.com/azure/cosmos-db/serverless-performance).
Stored constants are the implementation's numbers; heuristic thresholds and eligibility hints MUST NOT be presented
as proof of current Azure limits, migration eligibility or guaranteed cost savings.

## 8. Actions, permissions and feedback

### Actions and account metadata

Diagnostics collection is read-only; the dashboard as a whole is not: explicit create/delete actions reuse native wizards.
Creation/deletion entrypoints receive account data, not an Explorer-node lookup or reconstructed node.
Container creation validates the selected database against that account's ARM database list.
With All databases selected, it asks within the current account, including empty databases; no unscoped account picker.
Tree refresh/progress is secondary to the action, so an empty Explorer cache does not block the operation.

Create wizards make Overview dimmed/inert until cancellation, failure, or successful inventory reload.
Cancellation is not a failure. Delete success leaves the dashboard in its deleted-account state.
View Cost opens account-scoped portal Cost Analysis. View JSON reads the ARM resource and opens formatted JSON,
not account keys/connection strings. Data Modeler receives this account's metadata-derived capabilities without a picker;
it requires AI features enabled and available Copilot models, and does not refresh Overview on launch.
Suggested advisory actions do not execute Azure changes automatically.

Total throughput limit formatting: positive value -> RU/s; zero -> explicit 0 RU/s;
exactly -1 -> No total throughput limit; absent/null -> Unknown.
Serverless omits Total throughput limit in both the status strip and Account details.
This cap MUST NOT drive metric applicability, utilization or health.

### Source acquisition

| Source               | Host operation / constraint                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Cosmos control plane | Summary from bound resource metadata; database/container and offer enumeration; explicit account reads for JSON and advisory metadata |
| Monitor              | `metrics.list` against account resource ID; metric-specific aggregation, scope and interval                                           |
| Advisor              | Subscription-wide iteration and TTL cache described in section 6                                                                      |
| Alerts Management    | Target-account list described in section 6                                                                                            |
| Resource Graph       | Authenticated pipeline POST described in section 6; no new Resource Graph package                                                     |
| Log Analytics        | Resource-centric log queries described in section 7                                                                                   |

Monitor, Advisor and Alerts Management SDKs remain lazily acquired, off the extension activation hot path.
Reading diagnostics uses Azure identity permissions; write actions require separate write permissions.
Typical role assignments and log setup are described in the [user guide](../docs/account-overview-dashboard.md#permissions).
A role name in an empty state is guidance, not proof that a particular assignment is absent;
effective access also depends on scope and custom roles.

### Accessibility and errors

The four auxiliary actions `openUrl`, `revealInTree`, `openQueryEditor`, `showOutput` report failures once through the
shared native VS Code notification path. Local auxiliary catches do not redisplay or rethrow that notification.
A refused browser launch is a failure. Account-action/global-refresh feedback stays in the dashboard.
Background query unavailability is not routed through the auxiliary-action notification path.

Visible labels MUST remain in computed accessible names. Tooltip descriptions MUST preserve the visible label.
Status feedback uses existing announcement infrastructure; the health badge keeps one polite output.
The chart's storage-unavailable and metric-request-error messages use visible `<output>` elements with implicit
status semantics, matching the shared empty state.
Color is supplemented by labels/descriptions for severity, partial data and inapplicability.
Hidden tabs suppress list-result announcements; background initial collection does not announce list counts.
Inventory filter results announce politely after 300 ms; page changes announce the displayed range.
Sort buttons support Enter/Space and expose `aria-sort`.
Tabs wrap horizontally and use manual activation with Enter/Space.

Async completion MUST NOT steal focus from another editor or a control the user moved to.
If inventory refresh removes the focused element, focus fallback applies only on its active tab while the webview owns focus.
Dismissing a focused advisory moves to the next dismissal control, or previous at the end;
removing the group's last finding closes its dialog and focuses the surviving recommendations region.
Ordinary dialog closure retains Fluent's trigger-focus restoration.
The current chart does not establish complete screen-reader/exact-data-table acceptance; see section 10.

## 9. Verification contract

For a behavior change, update the relevant numbered section and the user explanation if its meaning changes.
For a behavior-preserving refactor, preserve the following cases through existing public test surfaces.
Use repository validation policy rather than introducing a second command sequence here.

| Contract            | Required regression examples                                                                                       | Principal test surface                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Health precedence   | Failed + no telemetry -> Critical; observed zero + successful clear summary -> Healthy; Succeeded alone -> Unknown | `overviewHealthModel.test.ts`, `services/accountHealth.test.ts`                                       |
| Health separation   | Critical container -> account Needs Attention + red container tab; warning-only -> no aggregate escalation         | `overviewHealthModel.test.ts`, `AccountOverview.test.tsx`                                             |
| Alert lifecycle     | List filters do not fetch summary; failed summary retains critical evidence; successful zero clears it             | `useOverviewHealthSignals.test.tsx`, `AccountOverview.test.tsx`                                       |
| Async sequencing    | Older result/rejection ignored; unmount ignored; fresh nested tRPC proxies do not refetch                          | `useOverviewHealthSignals.test.tsx`                                                                   |
| Refresh             | Every section awaited after one failure; no duplicated account-signal request; controls unlock                     | `AccountOverview.test.tsx`, `AccountHeader.test.tsx`                                                  |
| Applicability       | Serverless RU/throughput make zero Monitor calls; other metrics unaffected; unknown capacity not inapplicable      | `metricSeriesRouter.test.ts`, `hostFetchers.test.ts`, `MetricsSection.test.tsx`                       |
| Storage             | Zero, missing component, failed component, mismatched timestamps, shared gaps and newer partial bucket             | `metrics/storage.test.ts`, `hostFetchers.test.ts`, `MetricChart.test.tsx`, `inventoryMetrics.test.ts` |
| Documents           | Replica max, sum across containers, staggered snapshots, no observation -> not zero                                | `hostFetchers.test.ts`, `inventoryMetrics.test.ts`                                                    |
| Partition           | p99 hot vs uniform saturation, zero-sized storage, Serverless coerced to Storage                                   | `partitionHealth.test.ts`, `partitionHealthRouter.test.ts`                                            |
| Detectors           | Equality at each threshold, age/sample abstention, missing evidence, per-scope supersession                        | `derivedAdvisories*.test.ts`, `collectParity.test.ts`, `diagnosticPolicy.test.ts`                     |
| Index exclusions    | Both exact root `_etag` spellings ignored; real/nested exclusions retained                                         | `inventory.test.ts`, `derivedAdvisories.test.ts`                                                      |
| Actions             | Bound account without Explorer node; cancellation, successful reload, no duplicate auxiliary notification          | `accountResourceActions.test.ts`, router/action tests, `AccountOverview.test.tsx`                     |
| Accessible feedback | Visible/computed label agreement, one health status, locked-control focus, no hidden-tab announcement              | `AccountHealthStatus.test.tsx`, header/dashboard tests; manual screen-reader acceptance               |

The table names test files, not an assertion that every manual acceptance check has passed.
Threshold tests must distinguish `>` from `>=`, notably account/chart 429 vs diagnostic whole-window 429,
storage ratio equality, Serverless peak floor equality and storage-growth horizon equality.

## 10. Known limitations and excluded work

These items are not authorization to silently change the current contract during unrelated work:

| Area                     | Current boundary                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unclosed-alert awareness | No workflow-state notification/count. A future requirement is awareness of Fired + New/Acknowledged, including informational incidents, separate from health escalation. Exact UX and source contract remain to be implemented. |
| Health completeness      | Healthy can coexist with unassessed Advisor/container checks; row fallback can show Healthy without a metric object.                                                                                                            |
| Error semantics          | Legacy `noData` can represent an error; only metric-specific paths have the distinct `error` reason.                                                                                                                            |
| Storage reconciliation   | No canonical account/container storage snapshot or cross-surface equality guarantee.                                                                                                                                            |
| Inventory scale          | No resumable/incremental enumeration, persisted continuation, or throughput-enumeration fast path is specified as implemented.                                                                                                  |
| Metric coverage          | Missing observations, dimension limits and Azure visibility can omit evidence; no complete coverage guarantee.                                                                                                                  |
| Right-sizing             | Zero-recovery findings and non-validated target RU suggestions remain; advisory text may differ from exact implemented inequality at boundary values. The predicates in section 7 describe actual evaluation.                   |
| Accessibility            | Automated labels/focus checks do not prove real VS Code screen-reader, themes, zoom or chart-value exploration acceptance. An exact chart data-table alternative is not implemented.                                            |
| External methodology     | CODA parity labels are historical mapping, not equality of all collectors, permissions, outputs or Azure limits.                                                                                                                |

The future alert-awareness requirement MUST NOT redefine Active to mean New, make all High derived advisories
account-health inputs, or replace independent Fired-summary health with the currently filtered alert list.
