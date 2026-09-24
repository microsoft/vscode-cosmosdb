# Account Overview v2

Status: incremental implementation. The original Overview remains the default.

## Goal

Build a second presentation of the existing account diagnostics, following the supplied Figma screenshots.
Validate whether a problem-first summary helps users identify an issue, locate the affected container,
understand the evidence, and reach an appropriate action. Do not assume that a more compact layout is
better for detailed investigation.

Reference: https://www.figma.com/design/RgwrFMG0yUblRG8ibvVRtt/Untitled?node-id=380-1556

The reference was inspected through three screenshots supplied on September 8, 2026, not through the
Figma document. They show the collapsed summary, expanded account details, and the lower page. Exact
spacing and responsive behavior are not specified. Screenshot numbers are illustrative, not fixtures
to present as real account data.

The [current dashboard documentation](account-overview-dashboard.md) describes the existing experience.
This document describes the target and the increments toward it; unchecked increments are not shipped.

## Scope and architecture

- Build the v2 presentation separately under `src/webviews/cosmosdb/AccountOverviewV2`.
- Keep the original presentation and its entry point working throughout the experiment.
- Share the account data/state module with both presentations. It owns loading, scope, polling,
  refresh, session dismissals, health composition, and host actions. Neither presentation duplicates
  the request lifecycle.
- Keep `accountOverviewAppRouter` and the existing host services. Extend contracts additively without
  renaming fields or changing their units, aggregation, scope, or meaning.
- Fetch new expensive data through explicit opt-in procedures, not as an incidental cost of opening v1.
- Place the version selector above the presentation seam. One shared state owner and only one
  presentation are mounted. Switching layouts must not create a second polling loop or lose filters.
- Reuse nonvisual logic, theme tokens, and accessibility utilities. Do not add v2 conditionals throughout
  the original visual modules or introduce a second backend.

The first increment extracts the existing state into `useAccountOverview`. It intentionally preserves
the current polling cadence, refresh scope, health rules, error behavior, and event payloads. Broader
lifecycle changes need their own regression coverage rather than being hidden inside the extraction.
The preview increment additionally clears inventory metrics when the selected window changes and
guards inventory/partition responses against out-of-order completion. These protections prevent the
summary from relabeling an older window's values as the current selection.

## Target information hierarchy

1. Account identity, time/scope context, refresh, and a compact expandable account-status row.
2. Account actions and the Data Modeler entry point.
3. Account health: the most relevant problems with evidence and next actions.
4. Throughput health: normalized RU, throttling, and provisioned versus consumed throughput.
5. Top RU consumers, with access to the complete resource inventory.
6. Latency and queries, partition skew, storage and index, availability and resilience.
7. Prioritized recommendations, with access to the complete findings.

Account details expand in the page and push subsequent content down; they are not a separate screen.
Full charts, inventory details, partition analysis, and all findings remain reachable. The compact
summary must not silently remove document counts, throughput modes, partition keys, indexing settings,
metric selection, time controls, refresh pause, or diagnostic-source coverage information.

The September 9 screenshots define the compact presentation: three throughput cards (normalized RU
with a small inline trend, measured 429 rate, provisioned versus consumed), a resource table, four
small diagnostic cards, and row-based findings/recommendations. Section headings sit outside the
cards. Full time-series charts remain in metric details rather than enlarging every summary card.
The normalized-RU sparkline uses the shared scope, window and refresh lifecycle without additional
requests. Unavailable, loading or mismatched snapshots are not drawn as measured data, and explicit
missing samples remain gaps. No consumption rate is inferred from saturation or unknown bucket duration.

Resource-table bars show normalized RU on a 0–100% scale; rows are still ranked by measured consumed
RU/s peaks. Those peaks may occur at different times. Seven-day data change is labeled in bytes,
not fabricated percentage growth. The 429 gauge also uses a labeled 0–100% scale; the screenshot's
5% investigation threshold is not an approved detector threshold. Compact vertical partition bars
use a fixed 0–100% scale and retain the selected mode's meaning (p99 saturation or storage share).
Measured labels are available alongside the graphics and in expandable details.
Metric-specific summary actions open the corresponding requests, latency, or availability chart, not
the default normalized-RU chart. The detail view retains the shared scope/window and allows switching metrics.

Detailed evidence, aggregation notes, source coverage and resource actions are available through
keyboard-operable disclosures. Partial/unavailable states stay visible when disclosures are closed.
The desktop layout uses three throughput columns and four diagnostic columns, reflowing on narrow
screens; the resource table scrolls horizontally without removing columns or actions.
Resource measurement notes open from the information button beside the table heading, not from an
extra disclosure below the table. Incomplete coverage remains visible without opening the notes.
The table reconciles metric dimensions with the current ARM inventory, preserving canonical names for
display and actions. Case-insensitive matches must be unique; ambiguous or unmatched activity and
Azure's `<empty>` dimensions are not named containers. Unattributed activity remains in account totals.
Measured containers rank first, followed by inventory containers without matched consumption (shown
with unavailable values, never an inferred share of account RU). The compact table still shows at most
five rows; the complete inventory remains accessible.

The expanded account header uses two columns of label/value rows, with cost and JSON actions inside
the disclosure footer. Backup policy includes retention when supplied. Additional metadata has a
secondary disclosure. Last-refreshed time, pause and window explanations belong to Refresh options,
not the account-properties grid; a paused state remains visible beside Refresh.
The four compact status fields have decorative vertical separators, excluded from accessible text.

## Data contract and gaps

| Target                       | Reuse now                                                                            | Required decision or extension                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and account details | Account summary: names, subscription, URI, regions, capacity, backup type, free tier | Retention duration is not exposed. Distinguish provisioning status from workload health; do not rename Healthy to Online.                                                                                                                                                    |
| Account health               | Azure Monitor alerts and derived findings                                            | Preserve source, severity, scope, and evidence. A derived finding is not an Azure alert. Define summary ranking and de-duplication without changing detector thresholds.                                                                                                     |
| Normalized RU                | Existing maximum-aggregated series and peak                                          | Define whether the main number means latest bucket or period peak. Label it explicitly; never substitute an average silently.                                                                                                                                                |
| Throttling rate              | Request/status-code inputs and existing throttling calculations                      | Expose aggregate `429 requests / total requests` with a defined window. No requests means no measured rate, not necessarily 0%. Period delta needs a comparison window and explicit percentage-point units.                                                                  |
| Provisioned versus consumed  | Provisioned throughput, total RU series, inventory throughput mode                   | Convert bucket RU to bucket-average RU/s before taking a peak; do not call it an instantaneous peak. Do not infer consumption by multiplying normalized RU by capacity. Aggregate shared database throughput once and distinguish autoscale max from provisioned throughput. |
| Top consumers                | Inventory, normalized RU peaks, storage snapshots and seven-day data growth          | Add per-resource consumed RU/s and 429 rate before ranking by consumed RU. Define growth denominator and period; do not label bytes as percent.                                                                                                                              |
| Latency and queries          | Direct/Gateway average latency inputs; existing log-based fan-out findings           | Current tile shows the peak of interval averages, not P99. Separate Direct/Gateway, P99 and slow-query counts need explicit definitions and data support. Fan-out is not synonymous with slow queries.                                                                       |
| Partition skew               | Container-scoped physical-partition diagnostics                                      | Current RU saturation is not a share of consumed RU. Define the summary container selection and obtain a true consumption distribution before labeling it as such.                                                                                                           |
| Storage and index            | Data/index snapshots and data growth                                                 | Index growth needs index history. Define whether total growth is period-over-period or first-to-last within a window, and distinguish data, index, and combined storage.                                                                                                     |
| Availability and resilience  | Service availability and read/write regions                                          | Expose automatic failover configuration; define a source for P99 replication latency. Do not equate configuration with measured availability.                                                                                                                                |
| Recommendations              | Azure Advisor and derived findings                                                   | Keep source-specific evidence. Confidence scores and quantified savings/throttling reduction are not calculated today. Advisor's optional benefit text is not a generic confidence/impact model.                                                                             |
| Actions                      | Existing extension capabilities and host navigation                                  | Wire each action explicitly with the correct account/container scope and existing confirmation/error handling. Do not ship inert links or perform destructive actions directly from the webview.                                                                             |

For the first preview, prefer accurate existing labels and values over exact screenshot text. Omit
unimplemented forecast/confidence fields rather than fabricate them. For supported data that cannot be
retrieved, retain reason-specific unavailable states. Missing permissions, diagnostic settings, missing
samples, serverless limitations, and partial coverage must not become zeros or an "all healthy" result.

## Interaction and accessibility

- Original stays the default until an explicit rollout decision. Preview is opt-in and clearly labeled.
- Preserve selected time range, scope, pause state, and session dismissals across layout switches.
- An account-level label must not imply that every signal follows one global time window: inventory
  growth, alert filters, and detector lookbacks have their own windows today.
- Use VS Code theme tokens in dark, light, and high-contrast themes; no hardcoded screenshot colors.
- Details use a keyboard-operable disclosure with `aria-expanded` and a named controlled region.
- Version switching retains focus on the selector. Detail navigation manages focus and provides a
  clear return path; changing layout must not strand focus in unmounted content.
- Visible action labels must be included in accessible names. Charts need textual equivalents;
  severity must not be conveyed only by color. Background updates must not repeatedly interrupt users.
- Tables remain navigable at narrow widths and increased zoom. Meaningful content and actions cannot
  disappear solely to match the screenshot's desktop width.
- Localize new user-facing strings through the existing extraction workflow.

## Implementation increments

Each increment must leave the extension usable and independently reviewable.

### 1. Shared foundation

- [x] Extract existing state, data loading, and host actions into `useAccountOverview`.
- [x] Keep v1 markup, accessibility, metric semantics, and router contracts unchanged.
- [x] Cover initial loading, scope/range changes, refresh/pause/visibility, cleanup, stale trend responses,
      partial metric availability, and health escalation with regression tests.

This extraction remains the shared foundation for both presentations.

### Preview decisions

- Normalized RU means the **period peak**, not an unlabeled latest value or average.
- The opt-in resource ranking uses **peak bucket-average consumed RU/s**. Each resource's peak can
  occur at a different time; adding those peaks does not establish the account's simultaneous peak.
  Missing resource measurements are not assigned zero, and incomplete split coverage is explicit.
- Latency remains the peak of interval averages; it is not P99. Partition saturation is not a
  consumption share. Existing metric and partition drill-downs retain the full evidence.
- Confidence, estimated percentage savings, slow-query counts, replication P99 and index week-over-week
  growth are omitted until supported by a defined data source and methodology. Index growth is instead
  exposed as first-to-last byte change over seven days, requiring at least two samples.
- Additional analytics use an aligned complete-bucket window. The throttling percentage is
  `100 * sum(429 requests) / sum(all requests)`, unavailable when no requests were measured.
  Consumed RU/s is `max(bucket RU / bucket seconds)`, not instantaneous throughput.
- Provisioned capacity keeps its existing reported-maximum semantics. No account capacity is derived
  by summing per-container shared-throughput allocations, and no consumption is inferred from normalized RU.
- Add/create/delete/cost/JSON actions use existing host flows. Data Modeler is omitted because no
  implementation or registered command exists in this repository.
- Preview does not replace Original. Human usability evaluation and a default-version decision are
  release gates, not implementation tasks that automated tests can approve.

### 2. Opt-in preview and account summary

- [x] Add a selector and separate v2 presentation backed by the same state owner.
- [x] Implement identity, real scope/time context, refresh/pause, and expandable account details.
- [x] Keep a clear route back to the complete original presentation while the preview is incomplete.
- [x] Verify that switching presentations preserves state and does not issue duplicate requests.

### 3. Problem-first summary

- [x] Build Account health and Prioritized recommendations from current findings.
- [x] Preserve Azure/derived provenance, severity, evidence, partial coverage, and dismissals.
- [x] Define and test summary ranking and any de-duplication; keep the complete lists accessible.
- [x] Wire only actionable links with a valid destination and resource scope.

### 4. Metrics and resource summaries

- [x] Implement throughput, resource, latency, partition, storage, and availability summaries using
      the current truthful metrics.
- [x] Provide access to full charts, inventory and partition details.
- [x] Define the new rate/growth/aggregation semantics explicitly before exposing them (see Preview decisions).
- [x] Add compatible fields or opt-in procedures, with tests for units, scopes, missing data and shared
      throughput accounting. Both original and preview must keep working.

### 5. Actions and additional analytics

- [x] Wire create/delete, cost and JSON navigation using existing extension flows.
- [ ] Data Modeler requires a separate capability; no inert preview action is provided.
- [x] Add retention/failover configuration and additional measured metrics where supported.
- [x] Implement P99, slow-query counts, confidence or quantified impact only after their sources and
      methodology are agreed; otherwise keep them out of the preview.

### 6. Usability evaluation and rollout

- [ ] Compare both presentations on the same representative accounts and tasks: identify a problem,
      locate a container, understand the evidence, inspect a trend, and reach an action.
- [ ] Include idle, healthy, throttled, skewed, serverless, shared/autoscale, and permission-limited cases.
- [ ] Record task completion, incorrect interpretations, missing information and navigation friction,
      rather than using screenshot similarity as the acceptance criterion.
- [ ] Check keyboard/screen-reader flow, narrow widths, zoom and theme variants.
- [ ] Decide whether v2 becomes the default, remains an optional summary, or needs revision.
      Removing v1 is a separate decision, not an automatic final step.

## Validation

For code increments, run focused regression tests, localization extraction when strings change,
formatting, the complete lint suite, and all configured TypeScript build targets. Check process exit
codes. The preview increments also require interaction coverage for disclosure, switching and detail
navigation. Live Azure and manual assistive-technology checks must be recorded as outstanding when
they cannot be performed, not inferred from unit tests.

### Manual comparison protocol (release gate)

Use the same account and metric window in both layouts. Starting from the summary, locate the highest
priority finding, identify the affected database/container, inspect its evidence and a metric trend,
then reach the relevant host action. Record success, wrong interpretations and time to completion;
do not use a screenshot resemblance score as a substitute.

| Scenario                    | Interpretation to verify                                                               |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Idle account                | Missing request samples are not a measured 0% throttling rate or proof of health.      |
| Healthy account             | Source coverage remains visible even when available sources contain no findings.       |
| Throttled account           | Saturation and the measured 429 rate are distinct signals with labeled windows.        |
| Skewed container            | Partition saturation is not described as a percentage share of consumed RU.            |
| Serverless account          | Missing provisioned capacity is not rendered as zero provisioned RU/s.                 |
| Shared/autoscale throughput | Shared capacity is not counted per container; autoscale maximum is labeled separately. |
| Permission-limited account  | RBAC and diagnostic-settings gaps remain visible; actions report failures.             |

Repeat keyboard-only navigation, NVDA/VoiceOver reading, narrow widths, 200% zoom, and light/dark/
high-contrast themes. Confirm that disclosures push content down, headings receive detail-navigation
focus, and switching layouts preserves filters and pause. These live-account and human-assistive-
technology checks remain outstanding until actually performed.
