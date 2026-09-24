# Account Overview Dashboard

An at-a-glance dashboard for a single Cosmos DB (NoSQL) account, hosted as a VS Code webview.
Open it from an account node in the Azure resources tree (**Open Account Overview**). All Azure Resource
Manager (ARM) and Azure Monitor calls run on the extension host; the webview holds no tokens and talks to
the host over tRPC.

The incremental [Overview v2 specification](account-overview-v2-spec.md) describes a separate, opt-in
presentation. Use **Preview** at the top of the panel to open the problem-first summary; **Original**
remains the default. Both presentations share the loading, state, and action lifecycle in
`src/webviews/cosmosdb/AccountOverview/useAccountOverview.ts`. Switching does not reset the metric
window, database scope, refresh pause, or dismissed findings.

Preview follows the compact mockup: an inline account-details disclosure, a three-row health table,
three throughput cards (normalized-RU sparkline, 429 gauge, provisioned versus consumed), a resource
table, four diagnostic cards, and a matching three-row recommendations table. Each findings table shows
at most three ranked entries. **Account health** includes derived findings about current problems and risks
(such as hot partitions, throttling and storage skew), together with Azure Monitor alerts.
**Prioritized recommendations** combines Azure Advisor guidance with derived optimization opportunities:
over-provisioned throughput, idle containers, partition merges, autoscale/manual throughput changes and
serverless candidates. It stays at the bottom even when empty. This semantic split is Preview-only:
Original retains its separate source-based blocks. Advisor impact expresses importance, not alert severity.
Health groups the same detector across resources before selecting the top
three groups, with the most critical member determining each group's severity. **View all alerts** shows
the individual resource findings without grouping. A compact group names its first affected container;
when several are observed but the bounded scan cannot establish the total, it uses **+ others** rather
than an exact count. The health table header shows severity status and counts of individual findings before
grouping, excluding session-dismissed findings. Affected resources and estimated impact occupy separate
cells. Impact descriptions are qualitative potential effects for known derived checks, not predicted
percentages or savings; unknown effects are explicitly not estimated.
**View all alerts** and **View all recommendations** open separate Preview
dialogs over the summary, containing the complete corresponding list, evidence, source availability and
actions. Diagnostic coverage is not a summary block: source-specific pills in the health table header
and beside the recommendation heading
flag missing access, disabled logs and unavailable sources. Hover or activate a pill to read the explanation
and access role/diagnostic-settings guidance or refresh where applicable. Closing a dialog returns focus to its trigger.
Both categories depend on derived checks; only health depends on Monitor alerts and log-based checks,
and only recommendations depend on Advisor. Full lists retain session dismissal of derived findings in
their respective categories.
**Metric details**, **Databases and Containers**, and **Partition Key Distribution Health** open the existing
diagnostic widgets without starting another shared data lifecycle. **Back to summary** returns to the
compact layout; keyboard focus moves to the destination heading.
**View RU consumption details** opens a dedicated Preview dialog, retaining the selected scope and
time window. It shows the latest reported normalized RU, period peak, estimated time in complete
intervals whose maximum exceeds 80%, and the measured 429 rate. Missing intervals are excluded from
the estimate and its observed coverage is shown; bucket maxima do not establish continuous duration.
The yellow chart includes an 80% guide and preserves missing intervals as gaps. Guidance distinguishes
measured physical-partition skew from general investigation steps and never invents logical-key evidence.
The ranked list shows the top three reported containers by peak normalized RU and matched container-level
429 rates where available. Loaded physical-partition data is separately identified by container and p99,
not presented as logical-key values or period peaks. **Review hot partitions** opens existing partition
diagnostics in RU mode. Escape or Close returns focus to the dialog trigger.
**View 429 throttling details** opens a dedicated dialog with current and previous-window rates, relative
change (distinct from the summary's percentage-point delta), and the 5% investigation guide. Its distribution
uses measured container-level throttled-request counts, not logical-key samples. Unattributed activity and
incomplete coverage remain explicit. Individual request times, operations, partition-key values, retry delays,
and retry outcomes are not available from these aggregate metrics; the affected-requests table says so.
**Review capacity details** opens a capacity dialog with measured peak demand, reported provisioned/autoscale
values, ranked resource demand, and illustrative linear traffic scenarios. Account/database maxima are not
total allocated capacity, so headroom and capacity assessments are unavailable for incomparable scopes.
Both dialogs use the same scrollable layout and **Review hot partitions** action as RU details.
**Inspect latency** and **Inspect availability** still open their corresponding metric charts directly.
Generic metric and inventory navigation remain available without opening throughput dialogs.
The status strip uses vertical separators between fields. Resource-table measurement notes are available
from the information button beside its heading; incomplete coverage remains visible above the table.
The Preview scope selector uses **All Databases** for account-wide metrics. Accounts with multiple distinct
read/write regions also show **All regions** as a scope indicator, not a regional filter.
The Preview status strip labels the ARM provisioning state as **Status**, displaying `Succeeded` as
**Online** to match Database Hub. Other states retain their names; missing state is **Unknown**.
This display mapping does not change the source state or imply measured connectivity or workload health.
Status uses a tinted pill with a decorative dot: Online is green; Creating, Updating, Deleting, and Canceled
are yellow; Failed is red; Unknown is neutral. Colors follow the active VS Code theme and supplement the text.

Metric time/scope controls do not change every data source: inventory is account-wide, data growth
uses seven days, alerts have their own window, and advisory detectors retain their own lookbacks.
Preview labels statistics explicitly and does not invent latency percentiles, confidence scores,
or estimated savings from the design. Missing metric data stays visible; finding-source availability is
explained by heading pills and in the full-list dialogs rather than in a diagnostic-coverage summary block.

Throughput health follows the three-card layout: **Normalized RU Consumption**, **429 throttling rate**,
and **Provisioned vs consumed**, with per-card detail actions aligned at the bottom.
Normalized RU shows the latest usable reported sample separately from the selected period's peak;
the yellow sparkline is still maximum utilization across partition-key ranges, not a share of consumed RU.
Measurement notes identify the sample times and aggregation rather than implying an instantaneous reading.
The 429 gauge uses **5% investigate** as a visual guide, not a new alert/detector threshold or an SLA.
Its fill is capped at the guide while the number retains the actual measured rate. The displayed change
is in **percentage points** versus the immediately preceding equal-length window, not relative percentage
growth. No comparison is shown when the preceding rate cannot be established.
Guidance about the typical 1-5% range is conditional on acceptable end-to-end latency and partition
distribution; the overall rate alone does not prove retries succeed or throttling is confined to one partition.

Preview also requests additional analytics through the existing router, only while opted in:
the current and preceding total-window 429 request percentages, peak bucket-average consumed RU/s,
per-resource current statistics, and the latest reported maximum autoscale throughput.
Rate and consumed-RU measurements use complete buckets, and exact windows are available in measurement notes. No measured requests
means an unavailable rate, not 0%. Resource ranking uses measured consumed RU/s and discloses incomplete
split-query coverage. Index growth reuses seven-day history and is a first-to-last byte change, not WoW.
Named rows use uniquely matched ARM inventory identities, including their original casing for actions.
Empty or ambiguous metric dimensions cannot become container rows or take a top-five slot. Containers
without matched consumption follow measured rows with unavailable values; account totals retain
unattributed activity rather than assigning it to a missing container.
The additional requests follow the shared refresh generation; they do not create another polling timer.
The capacity card shows **Consumed peak**, **Provisioned now**, and **Autoscale max**. Consumed peak is a
peak bucket-average rate, not an instantaneous rate. Provisioned now is the latest reported
`ProvisionedThroughput` Maximum for the selected scope, not the sum of shared/container allocations.
Autoscale max comes from `AutoscaleMaxThroughput` Maximum, not the account throughput-limit setting or
a value inferred from normalized RU. Neither maximum represents a summed account allocation. Serverless
capacity is not applicable; absent autoscale measurements are not replaced by zero.

These interpretations follow the Azure guidance on
[normalized RU](https://learn.microsoft.com/azure/cosmos-db/monitor-normalized-request-units),
[429 responses](https://learn.microsoft.com/azure/cosmos-db/troubleshoot-request-rate-too-large), and
[supported metric definitions](https://learn.microsoft.com/azure/cosmos-db/monitor-reference).

**Add database**, **Add container**, and **Delete account** delegate to existing scoped extension flows,
including deletion confirmation. Select a database in **Metric scope** before adding a container;
empty databases are included. **View cost** opens the account's cost analysis and **JSON view** opens
its ARM configuration. Resource creation reloads static inventory. Preview includes a **Try Data Modeler**
placeholder beside the account actions; it performs no action and explains on hover or keyboard focus
that the feature is not implemented yet. Busy actions remain disabled without a separate progress message;
action failures remain visible. Account details expose backup retention/interval
and automatic-failover configuration when ARM supplies them; configuration is not a resilience measurement.
Preview combines backup type and retention in **Backup policy**, adding the reported backup interval for
Periodic mode. Additional account properties omit the duplicate retention and throughput-limit rows and
the standalone interval row; the throughput limit remains in the status strip.
**JSON view** fetches the account on demand and formats the original ARM response, not the flattened SDK
model. It preserves the `properties` envelope, unmodeled fields, and timestamp strings. The request uses
the extension's configured ARM API version, so the returned fields may differ from a portal API version.

This document describes **what the dashboard ships today** — the metrics it renders, the detections it
computes, where each one surfaces in the UI, and the ARM endpoints it calls. The broader detection
methodology and fleet-grounded thresholds live in the CODA project (see [CODA reference](#coda-reference));
this page is _what we have_, not what CODA has.

## Layout

The original presentation is two columns:

- **Main column (left)** — account header, metric charts, the inventory table, and the partition-health
  heatmap. Several detections surface **inline** here (health badges, flagged tiles, throttling bands).
- **Right rail (`aside`)** — three cards: **Active Alerts** and **Recommendations** (both Azure
  passthrough), and **Derived Advisories** (our client-side rule engine).

## Metrics rendered (Azure Monitor)

| Metric (Azure Monitor name) | Aggregation | Split dimension                   | Feeds                                                     |
| --------------------------- | ----------- | --------------------------------- | --------------------------------------------------------- |
| `NormalizedRUConsumption`   | Maximum     | — / `PartitionKeyRangeId`         | RU trend chart, per-row peak RU, hot-partition share      |
| `ProvisionedThroughput`     | Maximum     | —                                 | provisioned RU/s reference line (min interval `PT5M`)     |
| `DataUsage`                 | Maximum     | `DatabaseName` / `CollectionName` | storage usage, 7-day storage growth                       |
| `IndexUsage`                | Maximum     | `DatabaseName` / `CollectionName` | index usage, indexing-cost signal                         |
| `DocumentCountV2`           | Maximum     | `DatabaseName` / `CollectionName` | per-container document count (best-effort snapshot gauge) |
| `TotalRequests`             | Total       | `StatusCode`                      | request volume + throttling (429 share) bands             |
| `TotalRequestUnits`         | Total       | —                                 | RU-volume metric chart                                    |
| `MetadataRequests`          | Total       | —                                 | metadata-ops metric chart                                 |
| `PhysicalPartitionSizeInfo` | Maximum     | `PhysicalPartitionId`             | partition storage skew                                    |

Chart granularity follows the selected time range: `1H` → `PT1M`, `24H` → `PT5M`, `7D` → `PT1H`.

## Detections we compute

Numbered `AO-Dx` for our own reference and mapped to the nearest CODA equivalent (`DX-xxx`). The
**CODA parity** column records how each rule compares to CODA's authoritative detector: ✅ at parity, 🟡
partial, ❌ different signal. Reaching full parity with CODA — both the divergent native rules and the
not-yet-ported detectors — is a tracked goal (see Phase 9/10 in the plan). All defaults live under
`cosmosDB.accountOverview.*` and can be tuned without a redeploy.

| #      | Detection                       | Trigger (default)                                                                                        | Surface                                           | CODA map                 | CODA parity                                 |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------ | ------------------------------------------- |
| AO-D1  | Account / row health            | peak RU ≥ 80 / 90 %; sustained 429                                                                       | Header pill + inventory row badges                | DX-005                   | RU bands ✅ (growth → AO-D9)                |
| AO-D2  | Hot partition                   | busiest physical-partition p99 ≥ 90 % saturation while another < 70 % headroom (7-day)                   | Heatmap tile (flagged) **and** Derived Advisories | DX-006                   | ✅ p99 saturation + headroom (DX-006)       |
| AO-D3  | Storage skew                    | coolest ÷ busiest partition size < 0.7, busiest ≥ 1 GiB                                                  | Heatmap (storage mode) **and** Derived Advisories | DX-015                   | ✅ balance ratio (DX-015)                   |
| AO-D4  | Sustained throttling            | 429 rate ≥ 1 % with every partition p99 ≥ 90 % (uniform saturation, 7-day)                               | RU-chart bands **and** Derived Advisories         | DX-005 / DX-018          | ✅ 429-rate + uniform saturation (DX-005)   |
| AO-D5  | Over-provisioning               | 7-day p99 RU < 30 % (manual only), 90 % peak guard, relative-materiality severity                        | Derived Advisories                                | DX-001                   | ✅ band + peak guard + materiality (DX-001) |
| AO-D6  | Autoscale candidate             | peak ≥ 40 %, avg ≤ 30 %, peak/avg ≥ 5 (manual only)                                                      | Derived Advisories                                | DX-012                   | ✅ duty cycle (DX-012)                      |
| AO-D7  | Indexing cost risk              | index/data storage > 0.3, 0 excluded paths                                                               | Derived Advisories                                | — (CODA gap)             | ⚠️ storage proxy; wants write-RU share      |
| AO-D8  | Advisor + Alerts                | severity / impact from Azure                                                                             | Right rail (Active Alerts, Recommendations)       | — (ext-only passthrough) | ✅ passthrough                              |
| AO-D9  | Rapid storage growth            | physical-partition size trajectory reaches 50 GiB within horizon (High ≤ 30 d, Med ≤ 90 d)               | Derived Advisories                                | DX-017                   | ✅ least-squares horizon (DX-017)           |
| AO-D10 | Premium consistency             | Strong / Bounded Staleness across ≥ 2 regions (config fact)                                              | Derived Advisories                                | DX-016                   | ✅ config parity (DX-016)                   |
| AO-D11 | Multi-region writes antipattern | multi-region writes enabled on wrong-API, single write region, or non-prod (config fact)                 | Derived Advisories                                | DX-008                   | ✅ config parity (DX-008)                   |
| AO-D12 | Idle container                  | peak `TotalRequestUnits` ≤ 50 RU per bucket over 30 days (manual/autoscale); mode-aware recoverable RU/s | Derived Advisories                                | DX-004                   | ✅ idle signal + materiality (DX-004)       |
| AO-D13 | Partition-merge candidate       | physical partitions > max(ceil(RU/10 000), ceil(storage/50 GiB), 1) and ≥ 2                              | Derived Advisories                                | DX-009                   | ✅ actual vs needed (DX-009)                |
| AO-D14 | Autoscale max over-provisioned  | peak `AutoscaledRU` < 30 % of the configured max (autoscale only), idle-floor materiality                | Derived Advisories                                | DX-011                   | ✅ peak band + autoscale billing (DX-011)   |
| AO-D15 | Autoscale → manual candidate    | autoscale avg ≥ 66 % of max and peak/avg ≤ 1.3 (steady-high, autoscale only)                             | Derived Advisories                                | DX-013                   | ✅ duty cycle (DX-013)                      |
| AO-D16 | Serverless candidate            | account-total peak in (10, 5000] RU/s and avg/peak < 0.10 over 30 days (skipped if serverless)           | Derived Advisories                                | DX-014                   | ✅ low/sporadic shape (DX-014)              |
| AO-D17 | Cross-partition query fan-out   | ≥ 10 % of query executions fan out (avg ≥ 1.5 partitions), container ≥ 2 partitions, ≥ 50 queries (logs) | Derived Advisories (Tier-2)                       | DX-002                   | ✅ fan-out share + volume (DX-002)          |
| AO-D18 | Shard-key misalignment          | ≥ 60 % of executions fan out across ≥ 2 partitions (logs); supersedes AO-D17 on the container            | Derived Advisories (Tier-2)                       | DX-007                   | ✅ structural fan-out (DX-007)              |
| AO-D19 | Uncontrolled ingestion          | write-RU ≥ 80 % and 429 rate ≥ 10 % over ≥ 1000 requests (logs); burst factor as evidence                | Derived Advisories (Tier-2)                       | DX-010                   | ✅ write-dominance + throttling (DX-010)    |
| AO-D20 | Shared-throughput starvation    | pool 429 ≥ 5 %, one collection ≥ 60 % of RU, a sibling throttling ≥ 5 % at ≤ 20 % share (logs)           | Derived Advisories (Tier-2)                       | DX-003                   | ✅ 429 + consumption disparity (DX-003)     |

### Where each detection surfaces

Detections are **not** confined to the right rail. Some render inline in the charts/tables, some only as a
text advisory, and a few in both places:

| Detection                              | Right rail (Derived Advisories)            | Main column (chart / table)                       |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| AO-D1 Account / row health             | —                                          | Health pill (header) + per-row badges (inventory) |
| AO-D2 Hot partition                    | ✅ advisory                                | ✅ flagged tile in the partition heatmap          |
| AO-D3 Storage skew                     | ✅ advisory                                | ✅ heatmap in storage mode                        |
| AO-D4 Sustained throttling             | ✅ advisory                                | ✅ shaded bands on the RU trend chart             |
| AO-D5 Over-provisioning                | ✅ advisory                                | —                                                 |
| AO-D6 Autoscale candidate              | ✅ advisory                                | —                                                 |
| AO-D7 Indexing cost risk               | ✅ advisory                                | —                                                 |
| AO-D8 Advisor + Alerts (passthrough)   | ✅ (Active Alerts + Recommendations cards) | —                                                 |
| AO-D9 Rapid storage growth             | ✅ advisory                                | —                                                 |
| AO-D10 Premium consistency             | ✅ advisory                                | —                                                 |
| AO-D11 Multi-region writes antipattern | ✅ advisory                                | —                                                 |
| AO-D12 Idle container                  | ✅ advisory                                | —                                                 |
| AO-D13 Partition-merge candidate       | ✅ advisory                                | —                                                 |
| AO-D14 Autoscale max over-provisioned  | ✅ advisory                                | —                                                 |
| AO-D15 Autoscale → manual candidate    | ✅ advisory                                | —                                                 |
| AO-D16 Serverless candidate            | ✅ advisory                                | —                                                 |
| AO-D17 Cross-partition query fan-out   | ✅ advisory (Tier-2 logs)                  | —                                                 |
| AO-D18 Shard-key misalignment          | ✅ advisory (Tier-2 logs)                  | —                                                 |
| AO-D19 Uncontrolled ingestion          | ✅ advisory (Tier-2 logs)                  | —                                                 |
| AO-D20 Shared-throughput starvation    | ✅ advisory (Tier-2 logs)                  | —                                                 |

**Passthrough vs derived:** the **Active Alerts** and **Recommendations** cards are Azure's own output
(Azure Monitor fired alerts and Azure Advisor), surfaced verbatim. The **Derived Advisories** card is the
only place our own `§13` rule engine writes to.

**Tier-1 vs Tier-2 (partial coverage):** most advisories (AO-D1..16) are **Tier-1** — computed from Azure
Monitor metrics + ARM config, always available. AO-D17..20 are **Tier-2**: they query the account's
`CDB*` diagnostic-log tables via a resource-centric Log Analytics query, so they need **Diagnostic Settings →
Log Analytics** enabled on the account **and** the **Log Analytics Reader** (or Monitoring Reader) role. When
Tier-2 is unavailable the Derived Advisories card still renders every Tier-1 advisory and surfaces the gap
explicitly — an inline, reason-specific notice ("diagnostic settings off" / "missing role" / "no data yet" /
"transient error") plus a **Partial coverage** pill — rather than a card-level empty state that would hide the
Tier-1 results.

## Threshold grounding

Every constant the rule engine ships is one of two kinds. A **platform limit** is a hard Azure number the
detector is _structurally_ correct to use (e.g. a physical partition's 50 GiB ceiling) — these are grounded
against public Azure documentation below. An **internal-guidance** constant is a heuristic cutoff calibrated
by CODA's fleet analysis, not a published Azure number; each is exposed under
`cosmosDB.accountOverview.advisories.*` and should be read as a tunable starting point, not an Azure-sanctioned
threshold.

### Grounded in public Azure documentation (platform limits)

| Constant (code)                                                          | Default     | Grounding                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RU_PER_PARTITION` (DX-009 needed-partition math; DX-005/006 base)       | 10,000 RU/s | A physical partition serves up to **10,000 RU/s** — [Partitioning](https://learn.microsoft.com/azure/cosmos-db/partitioning#physical-partitions).                                                                             |
| `BYTES_PER_PARTITION` / `PARTITION_STORAGE_LIMIT_BYTES` (DX-009/015/017) | 50 GiB      | A physical partition stores up to **50 GB** — [Partitioning](https://learn.microsoft.com/azure/cosmos-db/partitioning#physical-partitions).                                                                                   |
| `AUTOSCALE_IDLE_FRACTION` (DX-011 recoverable idle-floor)                | 0.1         | Autoscale bills between **10% and 100%** of `Tmax` (`0.1*Tmax ≤ T ≤ Tmax`) — [Autoscale](https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale#how-autoscale-throughput-works).                          |
| `serverlessPeakCeilingRuPerSec` (DX-014 serverless fit ceiling)          | 5,000 RU/s  | A serverless container caps at **5,000 RU/s** — [Serverless performance](https://learn.microsoft.com/azure/cosmos-db/serverless-performance#request-unit-changes).                                                            |
| `OVERPROVISIONING_MIN_RU` (DX-001 right-size floor)                      | 400 RU/s    | Minimum manual throughput per container is **400 RU/s** — [Provision throughput](https://learn.microsoft.com/azure/cosmos-db/set-throughput).                                                                                 |
| `autoscaleToManualAvgPercent` (DX-013 break-even)                        | 66 %        | Autoscale saves money only if `Tmax` is used **66% or fewer hours/month**; steadier use is cheaper on manual — [Autoscale](https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale#benefits-of-autoscale). |

### Internal-guidance (CODA fleet-calibrated; tune via settings)

The signals these ride on (e.g. `NormalizedRUConsumption` %, 429 rate) are Azure-published metrics; the
cutoffs below are CODA guidance, not Azure limits.

| Constant(s)                                                         | Default       | Role                                                                                    |
| ------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `partitionSaturationPercent` / `partitionHeadroomPercent`           | 90 % / 70 %   | p99 bands separating a saturated partition from one with headroom (DX-005/006).         |
| `throttleRatePercent`                                               | 1 %           | 429-rate floor above which throttling counts as active (DX-005).                        |
| `overProvisioningBandPercent` + `OVERPROVISIONING_PEAK_GUARD_PCT`   | 30 % / 90 %   | Idle band + peak-saturation guard (DX-001).                                             |
| Materiality `MATERIALITY_*` (rel `5 % / 1 %`, abs `5000 / 1000 RU`) | —             | Relative capacity-materiality severity (DX-001/004/011).                                |
| Under-provisioning severity `20 % / 5 %`                            | —             | 429-rate severity bands (DX-005).                                                       |
| Autoscale-candidate `40 % / 30 % / 5×`                              | —             | Duty-cycle burst signal (DX-012).                                                       |
| `storageGrowthHorizonDays` + `30 / 90 d` severity                   | 180 d         | Days-to-50-GiB projection horizon (DX-017).                                             |
| `storageSkewBalanceRatio` + `1 / 25 / 40 GiB`                       | 0.7           | Partition-balance ratio + materiality (DX-015).                                         |
| `indexingUsageRatio`                                                | 0.3           | Index/data storage proxy (AO-D7; no CODA detector).                                     |
| `idlePeakRuPerBucket`                                               | 50 RU         | Near-zero per-bucket floor for idle (DX-004).                                           |
| `autoscaleToManualPeakToAvgRatio`                                   | 1.3           | Steadiness cap pairing with the 66 % floor (DX-013).                                    |
| `serverlessSporadicRatio` + `serverlessPeakFloorRuPerSec`           | 0.1 / 10 RU/s | Sporadic-shape ratio + activity floor for serverless fit (DX-014).                      |
| `ADVISORY_WINDOW_DAYS` / `ADVISORY_INTERVAL`                        | 30 d / `PT1H` | Look-back window + bucketing so periodic (monthly-batch) workloads aren't flagged idle. |

## Health model

- **Account health** (`Healthy / Needs Attention / Critical`): base state from ARM `provisioningState` plus
  sustained throttling, then **escalated** (never downgraded) by fired alerts (Sev0/1 → Critical; Sev2/3 →
  Needs Attention) and high-impact Advisor Performance/Cost recommendations.
- **Row health** (per database/container): `Critical` on throttling or `peakRuPercent ≥ 90 %`;
  `Needs Attention` on `peakRuPercent ≥ 80 %`; else `Healthy`. Storage growth no longer feeds row health —
  proximity to the 50 GiB per-partition limit surfaces as the **AO-D9 / `StorageGrowthRisk`** derived
  advisory instead.

## Data sources — ARM endpoints

Each ARM SDK below is **dynamically imported** so it stays in the dashboard's lazy chunk, off the extension
activation hot path. Clients are created on the host from the account's `AzureSubscription` credentials
(Entra ID / AAD; no account keys).

| Data source             | SDK (lazy) / client                                      | api-version          | Operations called                                                                                                                                                              | tRPC procedure(s)                                                                      |
| ----------------------- | -------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Cosmos DB control plane | `@azure/arm-cosmosdb` · `CosmosDBManagementClient`       | `2024-11-15`         | Account config read from the tree's `DatabaseAccountGetResults`; `sqlResources.listSqlDatabases`, `getSqlDatabaseThroughput`, `listSqlContainers`, `getSqlContainerThroughput` | `getAccountSummary`, `getInventory`                                                    |
| Azure Monitor metrics   | `@azure/arm-monitor` · `MonitorClient`                   | `2019-07-01`         | `metrics.list(resourceUri, { metricnames, aggregation, timespan, interval, filter })`                                                                                          | `getMetricSeries`, `getInventoryMetrics`, `getPartitionHealth`, `getDerivedAdvisories` |
| Azure Advisor           | `@azure/arm-advisor` · `AdvisorManagementClient`         | `2024-11-18-preview` | `recommendations.list()` — **one subscription-wide call**, coalesced/cached (~55 s) and sharded client-side by `accountId` across open panels                                  | `getRecommendations`                                                                   |
| Azure Monitor Alerts    | `@azure/arm-alertsmanagement` · `AlertsManagementClient` | `2019-05-05-preview` | `alerts.getAll(scope, { timeRange, … })`                                                                                                                                       | `getAlerts`                                                                            |

The three lazy SDKs (`arm-monitor`, `arm-advisor`, `arm-alertsmanagement`) must **not** enter the main
activation bundle — verified via `bundle-analysis/extension-report-vite.json`.

### Action procedures (mutations, no ARM reads)

`openUrl`, `revealInTree`, `openQueryEditor` (deep-links / existing extension commands) and `reportEvent`
(telemetry). The dashboard never mutates Azure resources — all "fix" affordances deep-link out.

### Polling

- Metric trend charts: every 60 s.
- Lightweight ARM polls (account, throughput, inventory, alerts, advisor): every 30 s, staggered.
- Polling pauses when the panel is hidden (`document.visibilityState !== 'visible'`) and via the header's
  **Pause auto-refresh** toggle.

## Permissions (RBAC)

Each section reads with the user's Azure credentials and renders an **Access required** empty state (naming
the missing role) if a role is absent; the rest of the dashboard keeps working. See the role matrix in the
[README](../README.md#account-overview-dashboard). Least-privilege action strings per data source are
catalogued in CODA's [`docs/permissions.md`](https://github.com/azure-data-database-platform/coda/blob/main/docs/permissions.md).

## Checks & validations

- Unit tests per host service — `src/panels/accountOverview/services/*.test.ts`,
  `src/panels/accountOverview/metrics/*.test.ts`.
- Multi-panel Advisor rate-limit smoke test — asserts subscription-wide coalescing (reads are independent of
  the number of open panels).
- Bundle budget — the three ARM SDKs stay in the lazy chunk.
- Accessibility — `accessibility-aria-expert` checklist (live regions, focus management, heatmap SR labels,
  chart text alternatives, keyboard reach).
- Localization — every user-facing string via `l10n.t(...)`; run `npm run l10n` after string changes.

## CODA reference

The numbered detection taxonomy (`DX-001…DX-018`), fleet-grounded thresholds, RU-materiality, and $-savings
methodology live in the CODA project — a read-only Cosmos DB diagnostic engine. We treat it as the reference
source of truth for detection methodology:
[`azure-data-database-platform/coda`](https://github.com/azure-data-database-platform/coda) (EMU) — see
`docs/detections/`, `docs/evidence/`, and `docs/permissions.md`. A rule-by-rule critique of the dashboard's
current thresholds against CODA is in `docs/exploration/vscode-coda-integration/THRESHOLD-CRITIQUE.md` there.
