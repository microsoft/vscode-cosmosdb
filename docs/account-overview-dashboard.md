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
| `TotalRequests`             | Total       | `StatusCode`                      | request volume + throttling (429 share) bands             |
| `TotalRequestUnits`         | Total       | —                                 | RU-volume metric chart                                    |
| `MetadataRequests`          | Total       | —                                 | metadata-ops metric chart                                 |
| `PhysicalPartitionSizeInfo` | Maximum     | `PhysicalPartitionId`             | partition storage skew                                    |

Chart granularity follows the selected time range: `1H` → `PT1M`, `24H` → `PT5M`, `7D` → `PT1H`.

## Detections we compute

Numbered `AO-Dx` for our own reference and mapped to the nearest CODA equivalent (`DX-xxx`). The
**Correctness** column flags rules whose formula is known to mis-fire or use the wrong signal — fixes are
tracked as post-MVP work (Phase 9 in the plan). All defaults live under `cosmosDB.accountOverview.*` and can
be tuned without a redeploy.

| #     | Detection            | Trigger (default)                                         | Surface                                           | CODA map                 | Correctness            |
| ----- | -------------------- | --------------------------------------------------------- | ------------------------------------------------- | ------------------------ | ---------------------- |
| AO-D1 | Account / row health | RU ≥ 80 / 90 %; storage growth > 10 GiB/7d; sustained 429 | Header pill + inventory row badges                | DX-005 / DX-017          | RU bands ✅; growth ❌ |
| AO-D2 | Hot partition        | top physical-partition RU share ≥ 40 %                    | Heatmap tile (flagged) **and** Derived Advisories | DX-006                   | ❌ share ≠ saturation  |
| AO-D3 | Storage skew         | top physical-partition storage share ≥ 35 %               | Heatmap (storage mode)                            | DX-015                   | ❌ share-based         |
| AO-D4 | Sustained throttling | ≥ 30 continuous min of 429 share > 1 %                    | RU-chart bands **and** Derived Advisories         | DX-005 / DX-018          | 🟡 coarse              |
| AO-D5 | Over-provisioning    | 7-day peak RU < 25 % (manual only)                        | Derived Advisories                                | DX-001                   | 🟡 coarse              |
| AO-D6 | Autoscale candidate  | CV of 7-day RU > 0.5 (manual only)                        | Derived Advisories                                | DX-012                   | ⚠️ wrong statistic     |
| AO-D7 | Indexing cost risk   | index/data storage > 0.3, 0 excluded paths                | Derived Advisories                                | — (CODA gap)             | ⚠️ wrong signal        |
| AO-D8 | Advisor + Alerts     | severity / impact from Azure                              | Right rail (Active Alerts, Recommendations)       | — (ext-only passthrough) | ✅ passthrough         |

### Where each detection surfaces

Detections are **not** confined to the right rail. Some render inline in the charts/tables, some only as a
text advisory, and a few in both places:

| Detection                            | Right rail (Derived Advisories)            | Main column (chart / table)                       |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------- |
| AO-D1 Account / row health           | —                                          | Health pill (header) + per-row badges (inventory) |
| AO-D2 Hot partition                  | ✅ advisory                                | ✅ flagged tile in the partition heatmap          |
| AO-D3 Storage skew                   | —                                          | ✅ heatmap in storage mode                        |
| AO-D4 Sustained throttling           | ✅ advisory                                | ✅ shaded bands on the RU trend chart             |
| AO-D5 Over-provisioning              | ✅ advisory                                | —                                                 |
| AO-D6 Autoscale candidate            | ✅ advisory                                | —                                                 |
| AO-D7 Indexing cost risk             | ✅ advisory                                | —                                                 |
| AO-D8 Advisor + Alerts (passthrough) | ✅ (Active Alerts + Recommendations cards) | —                                                 |

**Passthrough vs derived:** the **Active Alerts** and **Recommendations** cards are Azure's own output
(Azure Monitor fired alerts and Azure Advisor), surfaced verbatim. The **Derived Advisories** card is the
only place our own `§13` rule engine writes to.

## Health model

- **Account health** (`Healthy / Needs Attention / Critical`): base state from ARM `provisioningState` plus
  sustained throttling, then **escalated** (never downgraded) by fired alerts (Sev0/1 → Critical; Sev2/3 →
  Needs Attention) and high-impact Advisor Performance/Cost recommendations.
- **Row health** (per database/container): `Critical` on throttling or `peakRuPercent ≥ 90 %`;
  `Needs Attention` on `peakRuPercent ≥ 80 %` or 7-day storage growth `> 10 GiB`; else `Healthy`.

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
