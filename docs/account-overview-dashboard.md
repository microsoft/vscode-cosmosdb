# Account Overview Dashboard

A read-only, at-a-glance dashboard for a single Cosmos DB (NoSQL) account, hosted as a VS Code webview.
Open it from an account node in the Azure resources tree (**Open Account Overview**). All Azure Resource
Manager (ARM) and Azure Monitor calls run on the extension host; the webview holds no tokens and talks to
the host over tRPC.

This document describes **what the dashboard ships today** — the metrics it renders, the detections it
computes, where each one surfaces in the UI, and the ARM endpoints it calls. The broader detection
methodology and fleet-grounded thresholds live in the CODA project (see [CODA reference](#coda-reference));
this page is _what we have_, not what CODA has.

## Layout

The panel is two columns:

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
| `TotalRequests`             | Count       | `StatusCode`                      | request volume + throttling (429 share) bands             |
| `TotalRequestUnits`         | Total       | —                                 | RU-volume metric chart                                    |
| `MetadataRequests`          | Total       | —                                 | metadata-ops metric chart                                 |
| `PhysicalPartitionSizeInfo` | Maximum     | `PhysicalPartitionId`             | partition storage skew                                    |

Chart granularity follows the selected time range: `1H` → `PT1M`, `24H` → `PT5M`, `7D` → `PT1H`.

## Detections we compute

Numbered `AO-Dx` for our own reference and mapped to the nearest CODA equivalent (`DX-xxx`). The
**CODA parity** column describes the detection signal, not identical report output or cloud permissions.
The reference is CODA commit `53d43cec4e46885d8610751e24d937bc794a4550`. Diagnostic policy lives in
`advisories/core/thresholds.ts`; only the existing tunable subset is exposed under `cosmosDB.accountOverview.*`.
Charts retain their selected display windows, independently of the detectors' observation windows.

| #      | Detection                       | Trigger (default)                                                                                        | Surface                                           | CODA map                 | CODA parity                                 |
| ------ | ------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------ | ------------------------------------------- |
| AO-D1  | Account / row health            | peak RU ≥ 80 / 90 %; sustained 429                                                                       | Header pill + inventory row badges                | DX-005                   | RU bands ✅ (growth → AO-D9)                |
| AO-D2  | Hot partition                   | busiest physical-partition p99 ≥ 90 % saturation while another < 70 % headroom (7-day)                   | Heatmap tile (flagged) **and** Derived Advisories | DX-006                   | ✅ p99 saturation + headroom (DX-006)       |
| AO-D3  | Storage skew                    | coolest ÷ busiest partition size < 0.7, busiest ≥ 1 GiB                                                  | Heatmap (storage mode) **and** Derived Advisories | DX-015                   | ✅ balance ratio (DX-015)                   |
| AO-D4  | Sustained throttling            | ≥ 1000 requests, 429 rate ≥ 1 %, busiest partition p99 ≥ 90 % and coolest ≥ 70 % (7-day)                 | RU-chart bands **and** Derived Advisories         | DX-005                   | ✅ 429-rate + uniform capacity pressure     |
| AO-D5  | Over-provisioning               | per-offer 30-day p99 RU < 30 % (dedicated manual), 90 % peak guard, account-relative materiality         | Derived Advisories                                | DX-001                   | ✅ band + peak guard + materiality (DX-001) |
| AO-D6  | Autoscale candidate             | peak ≥ 40 %, avg ≤ 30 %, peak/avg ≥ 5 (manual only)                                                      | Derived Advisories                                | DX-012                   | ✅ duty cycle (DX-012)                      |
| AO-D7  | Indexing cost risk              | index/data storage > 0.3, 0 excluded paths                                                               | Derived Advisories                                | — (CODA gap)             | ⚠️ storage proxy; wants write-RU share      |
| AO-D8  | Advisor + Alerts                | severity / impact from Azure                                                                             | Right rail (Active Alerts, Recommendations)       | — (ext-only passthrough) | ✅ passthrough                              |
| AO-D9  | Rapid storage growth            | physical-partition size trajectory reaches 50 GiB within horizon (High ≤ 30 d, Med ≤ 90 d)               | Derived Advisories                                | DX-017                   | ✅ least-squares horizon (DX-017)           |
| AO-D10 | Premium consistency             | Strong / Bounded Staleness across ≥ 2 regions (config fact)                                              | Derived Advisories                                | DX-016                   | ✅ config parity (DX-016)                   |
| AO-D11 | Multi-region writes antipattern | multi-region writes enabled on wrong-API, single write region, or non-prod (config fact)                 | Derived Advisories                                | DX-008                   | ✅ config parity (DX-008)                   |
| AO-D12 | Idle container                  | peak `TotalRequestUnits` ≤ 50 RU per 5-minute bucket over 30 days (dedicated manual/autoscale)           | Derived Advisories                                | DX-004                   | ✅ idle signal + materiality (DX-004)       |
| AO-D13 | Partition-merge candidate       | physical partitions > max(ceil(RU/10 000), ceil(storage/50 GiB), 1) and ≥ 2                              | Derived Advisories                                | DX-009                   | ✅ actual vs needed (DX-009)                |
| AO-D14 | Autoscale max over-provisioned  | peak `AutoscaledRU` < 30 % of the configured max (autoscale only), idle-floor materiality                | Derived Advisories                                | DX-011                   | ✅ peak band + autoscale billing (DX-011)   |
| AO-D15 | Autoscale → manual candidate    | autoscale avg ≥ 66 % of max and peak/avg ≤ 1.3 (steady-high, autoscale only)                             | Derived Advisories                                | DX-013                   | ✅ duty cycle (DX-013)                      |
| AO-D16 | Serverless candidate            | account-total peak in [10, 5000] RU/s, avg/peak < 0.10, ≥ 24 observations over 30 days (not serverless)  | Derived Advisories                                | DX-014                   | ✅ low/sporadic shape (DX-014)              |
| AO-D17 | Cross-partition query fan-out   | ≥ 10 % of query executions fan out (avg ≥ 1.5 partitions), container ≥ 2 partitions, ≥ 50 queries (logs) | Derived Advisories (Tier-2)                       | DX-002                   | ✅ fan-out share + volume (DX-002)          |
| AO-D18 | Shard-key misalignment          | ≥ 50 queries, ≥ 60 % fan-out rounded to one decimal, ≥ 2 partitions; supersedes AO-D17                   | Derived Advisories (Tier-2)                       | DX-007                   | ✅ structural fan-out (DX-007)              |
| AO-D19 | Uncontrolled ingestion          | write-RU ≥ 80 % and 429 rate ≥ 10 % over ≥ 1000 requests (logs); burst factor as evidence                | Derived Advisories (Tier-2)                       | DX-010                   | ✅ write-dominance + throttling (DX-010)    |
| AO-D20 | Shared-throughput starvation    | pool 429 ≥ 5 %, one collection ≥ 60 % of RU, a sibling throttling ≥ 5 % at ≤ 20 % share (logs)           | Derived Advisories (Tier-2)                       | DX-003                   | ✅ 429 + consumption disparity (DX-003)     |
| AO-D21 | Serverless throttling           | ≥ 1000 requests and 429 rate ≥ 1 % over 7 days; Medium ≥ 5 %, High ≥ 20 %, no partition-RU dependency    | Derived Advisories                                | DX-018                   | ✅ dedicated serverless request-count check |

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
| AO-D21 Serverless throttling           | ✅ advisory                                | Request-count / throttling charts                 |

**Passthrough vs derived:** the **Active Alerts** and **Recommendations** cards are Azure's own output
(Azure Monitor fired alerts and Azure Advisor), surfaced verbatim. The **Derived Advisories** card is the
only place our own `§13` rule engine writes to.

**Advisory details:** shared guidance appears above the resource list. Expand a resource for its specific details;
each finding can be dismissed individually.

**Data sources:** Tier-1 checks (AO-D1..16, AO-D21) use Azure Monitor metrics and ARM configuration.
Tier-2 checks (AO-D17..20) use Log Analytics, queried by account resource ID rather than workspace ID.
Export **DataPlaneRequests** and **QueryRuntimeStatistics** in **resource-specific** mode; legacy `AzureDiagnostics`
schemas are not supported. Query access must be granted separately from log collection:
see [Log Analytics access control](https://learn.microsoft.com/azure/azure-monitor/logs/manage-access).

**Partial coverage:** failed checks do not discard successful findings or imply zero usage; configuration checks
remain available when workload collection fails. The notice identifies failed checks, and **Show Output** opens
local diagnostic details. Successful queries may still exclude inaccessible data sources.

**Idle and partition-merge evidence:** query each known dedicated-throughput container by database and container ID,
with at most five concurrent requests for these metrics. Do not enumerate containers through wildcard metric series
or rely on a larger `top` limit. Missing or invalid samples remain unavailable, not zero: idle requires an observed RU
peak, and partition-merge requires both an observed partition count and storage value. A failed container query does
not discard evidence from other containers.

## Threshold grounding

Every constant the rule engine ships is one of two kinds. A **platform limit** is a hard Azure number the
detector is _structurally_ correct to use (e.g. a physical partition's 50 GiB ceiling) — these are grounded
against public Azure documentation below. An **internal-guidance** constant is a heuristic cutoff calibrated
by CODA's fleet analysis, not a published Azure number. The existing tunable subset is exposed under
`cosmosDB.accountOverview.advisories.*`; other diagnostic cutoffs remain internal policy, not new settings.
Neither should be read as an Azure-sanctioned threshold.

### Diagnostic policy source

[`DIAGNOSTIC_POLICY`](../src/panels/accountOverview/services/advisories/core/thresholds.ts) centralizes diagnostic
thresholds, observation windows, and minimum sample/age requirements. Supported VS Code settings override the defaults;
platform limits and chart time ranges remain separate.

### Grounded in public Azure documentation (platform facts and policy motivation)

| Constant (code)                                                          | Default     | Grounding                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RU_PER_PARTITION` (DX-009 needed-partition math; DX-005/006 base)       | 10,000 RU/s | A physical partition serves up to **10,000 RU/s** — [Partitioning](https://learn.microsoft.com/azure/cosmos-db/partitioning#physical-partitions).                                                                             |
| `BYTES_PER_PARTITION` / `PARTITION_STORAGE_LIMIT_BYTES` (DX-009/015/017) | 50 GiB      | A physical partition stores up to **50 GB** — [Partitioning](https://learn.microsoft.com/azure/cosmos-db/partitioning#physical-partitions).                                                                                   |
| `AUTOSCALE_IDLE_FRACTION` (DX-011 recoverable idle-floor)                | 0.1         | Autoscale bills between **10% and 100%** of `Tmax` (`0.1*Tmax ≤ T ≤ Tmax`) — [Autoscale](https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale#how-autoscale-throughput-works).                          |
| `serverlessPeakCeilingRuPerSec` (DX-014 serverless fit ceiling)          | 5,000 RU/s  | A serverless container caps at **5,000 RU/s** — [Serverless performance](https://learn.microsoft.com/azure/cosmos-db/serverless-performance#request-unit-changes).                                                            |
| `OVERPROVISIONING_MIN_RU` (DX-001 right-size floor)                      | 400 RU/s    | Minimum manual throughput per container is **400 RU/s** — [Provision throughput](https://learn.microsoft.com/azure/cosmos-db/set-throughput).                                                                                 |
| `autoscaleToManualAvgPercent` (DX-013 break-even)                        | 66 %        | Autoscale saves money only if `Tmax` is used **66% or fewer hours/month**; steadier use is cheaper on manual — [Autoscale](https://learn.microsoft.com/azure/cosmos-db/provision-throughput-autoscale#benefits-of-autoscale). |

### Internal-guidance (CODA fleet-calibrated; existing tunable subset via settings)

The signals these ride on (e.g. `NormalizedRUConsumption` %, 429 rate) are Azure-published metrics; the
cutoffs below are CODA guidance, not Azure limits.

| Constant(s)                                                                           | Default       | Role                                                                                    |
| ------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `partitionSaturationPercent` / `partitionHeadroomPercent`                             | 90 % / 70 %   | p99 bands separating a saturated partition from one with headroom (DX-005/006).         |
| `throttleRatePercent`                                                                 | 1 %           | 429-rate floor above which throttling counts as active (DX-005).                        |
| `overProvisioningBandPercent` + `DIAGNOSTIC_POLICY.overProvisioning.peakGuardPercent` | 30 % / 90 %   | Idle band + peak-saturation guard (DX-001/011).                                         |
| `DIAGNOSTIC_POLICY.capacityMateriality` (rel `5 % / 1 %`, abs `5000 / 1000 RU`)       | —             | Relative capacity-materiality severity (DX-001/004/011).                                |
| Under-provisioning severity `20 % / 5 %`                                              | —             | 429-rate severity bands (DX-005).                                                       |
| Autoscale-candidate `40 % / 30 % / 5×`                                                | —             | Duty-cycle burst signal (DX-012).                                                       |
| `storageGrowthHorizonDays` + `30 / 90 d` severity                                     | 180 d         | Days-to-50-GiB projection horizon (DX-017).                                             |
| `storageSkewBalanceRatio` + `1 / 25 / 40 GiB`                                         | 0.7           | Partition-balance ratio + materiality (DX-015).                                         |
| `indexingUsageRatio`                                                                  | 0.3           | Index/data storage proxy (AO-D7; no CODA detector).                                     |
| `idlePeakRuPerBucket`                                                                 | 50 RU         | Near-zero per-bucket floor for idle (DX-004).                                           |
| `autoscaleToManualPeakToAvgRatio`                                                     | 1.3           | Steadiness cap pairing with the 66 % floor (DX-013).                                    |
| `serverlessSporadicRatio` + `serverlessPeakFloorRuPerSec`                             | 0.1 / 10 RU/s | Sporadic-shape ratio + activity floor for serverless fit (DX-014).                      |
| `DIAGNOSTIC_POLICY.{idle,serverless,autoscaleUtilization}.observation`                | 30 d / `PT1H` | Look-back window + bucketing so periodic (monthly-batch) workloads aren't flagged idle. |

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

### Action procedures

`openUrl`, `revealInTree`, `openQueryEditor` (deep-links / existing extension commands), `showOutput` (extension Output), and `reportEvent`
(telemetry). Failures of the four auxiliary actions are displayed once as native VS Code error notifications through
the shared RPC event channel; their local catches neither redisplay nor rethrow the same error. Background query and
telemetry errors do not use this notification path. A refused browser launch is an explicit action failure.
Existing account-action and refresh feedback remains in the dashboard.

`runAccountAction` invokes the existing scoped create/delete commands or opens account costs/JSON.
Advisory guidance does not automatically modify Azure resources.
Alert links and View Cost preserve `subscription.environment.portalUrl` and include the subscription's tenant,
matching Azure Resources' portal selection convention. This preserves public, sovereign and configured `ms.portal`
destinations without guessing the portal from a tenant ID.

### Loading and refresh

- Data loads when Overview opens. There are no polling timers, refresh-on-visibility handlers or auto-refresh settings.
- **Refresh** reloads every section: account summary, inventory, metric trends, inventory metrics, the selected
  container's partition health, alerts, Azure Advisor recommendations and derived advisories. It waits for all requests.
- Metric time-range changes reload trends, time-dependent inventory metrics and the selected partition view.
  Database-scope changes reload trends only; partition selection/measure and alert-window changes reload their own data.
  Switching tabs, showing a chart or returning to the editor does not itself fetch data.
- **Charts generated at**, to the left of the header filters, shows the local date and time when the latest accepted
  trend batch produced available chart results. It is absent before any chart results are available or when the whole
  batch is unavailable. It is not a
  timestamp for all sections, the Azure ingestion time or the latest metric sample.
- A spinner inside **Refresh** indicates an explicit Refresh or header filter change, not initial loading.
  The button keeps its Refresh label; no separate updating text is displayed.
  Refresh and both header selectors remain unavailable while existing data requests finish, including initial loading.
  They unlock after completion or failure without resetting the selected database or period.
  Individual sections show their own loading state.
- Alert-window buttons are disabled while alerts load, including initial collection, a period change and manual Refresh.
  They remain disabled until the whole manual Refresh settles. Repeated selection does not reload data; failed requests
  unlock the buttons and replace stale alerts with an unavailable state. Latest-request guards also protect result publication.
- Successful database/container creation retains its existing inventory reload. Filters and selections are preserved.

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
