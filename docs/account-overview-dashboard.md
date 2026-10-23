# Account Overview guide

Account Overview helps you answer three questions about an Azure Cosmos DB for NoSQL account:
**What is happening? Which resources need attention? What should I investigate next?**

In the Azure resources Explorer, open your account's **Account Overview → Overview**.
The account stays the same as you move between tabs or select a database.
Reading the dashboard does not change Azure resources. Actions such as **Add database**, **Add container**
and **Delete account** are separate, explicit operations with the extension's usual wizard or confirmation.

This guide explains the current repository implementation. Maintainers and coding agents should use the
[implementation specification](../specs/account-overview.md) for exact calculations, lifecycle rules and known limitations.

## Start here

1. Check **Health** beside the account name. Focus or hover over the badge to see what was checked and what is unknown.
2. Use **Monitoring** to compare traffic, throughput, storage and latency over the last hour, day or week.
3. Open **Databases and Containers** to find a particular container and investigate its physical partitions.
4. Open **Advisories** for suggested investigations, Azure Advisor recommendations and Azure Monitor alerts.
5. Select **Refresh** when you want a new snapshot. Overview does not update automatically.

The header remains visible across the three tabs. Expand **Account details** for provisioning status,
capacity mode, account properties, **View Cost** and **View JSON**.
The Explorer's metric shortcuts select a chart in the same dashboard, preserving your filters.
Use the smiley **Provide Feedback** button beside **Refresh**, then choose **Provide Feedback** in its menu,
to open the same NoSQL survey available in Query Editor. The button respects VS Code's
`telemetry.feedback.enabled` preference, including changes made while Overview is open.
Opening Overview does not accumulate survey usage or trigger an automatic feedback prompt.

## Understanding health

**Health is an extension diagnostic summary, not Azure Resource Health or an availability guarantee.**
It combines provisioning problems, account-wide throttling, active Azure alerts, selected Azure Advisor
recommendations and critical containers.

| Badge               | What it means                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Critical**        | Account provisioning failed/was canceled, sustained account-wide throttling was detected, or a Sev0/Sev1 active alert was found.                                                    |
| **Needs Attention** | The account is being created/updated/deleted, a Sev2/Sev3 active alert exists, a High-impact Performance/Cost Advisor recommendation exists, or at least one container is Critical. |
| **Healthy**         | Account request observations support a healthy result and none of the available contributing signals escalates it. This does not mean every check has complete data.                |
| **Unknown**         | There is insufficient evidence for a healthy result, or active alerts could not be checked and there is no known problem to show instead.                                           |

Known problems take priority over Healthy or Unknown. One unavailable check does not erase a known critical alert.
If an alert refresh fails, Overview retains previously known alert problems until a successful check replaces them.
The checklist tells you whether each check passed, found a problem, is still running, or could not be assessed.

### What counts as account throttling?

HTTP **429** means a request was throttled. For the health badge, Overview checks the **whole account**
over the last hour, in one-minute buckets. It flags a run lasting at least five minutes when **more than 1%**
of requests in each qualifying bucket received 429.

For example, five consecutive minutes above 1% can make account health Critical.
A single busy container does not do so by itself: its 429s are compared with all account requests.
Changing the selected database or chart period does not change this account-wide check.
Actual observations of zero requests are valid; missing observations are not the same as zero.

### Why can a tab be red while account health only needs attention?

Tab warning icons point to the **source** of a problem, not a copy of the overall badge:

- **Monitoring:** sustained account-wide throttling.
- **Databases and Containers:** critical or warning container health.
- **Advisories:** active alert severity or qualifying Azure Advisor recommendations.

A Critical container gives its tab a red indicator but raises the account only to Needs Attention.
Warning-only containers give a yellow indicator without raising account health.
Informational alerts and the extension's Derived Advisories do not escalate account health.

### Health and Status are different

**Status** in Account details describes Azure provisioning; **Online** means provisioning succeeded.
It does not prove that the workload is healthy.

The health badge does **not** evaluate HTTP 5xx, service availability, latency, storage limits or index health.
Those charts and advisories may still contain important information when the badge is Healthy.
Also check any **Not assessed** entries: Healthy is not an all-clear for every possible issue.

## Reading Monitoring

Choose a period (**1 hour**, **24 hours** or **7 days**) and either **All databases** or one database.
Select a metric tile to show its chart. Switching charts does not trigger another data collection.
**Service availability always describes the account**, even when a database is selected.

The number on a tile is not always the last point on its chart:

| Metric                     | Meaning of the tile                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Normalized RU**          | Highest observed throughput utilization in the selected period. 100% is the provisioned-capacity reference, not “100 RU/s.”          |
| **Total requests**         | Sum of observed request counts in the selected period.                                                                               |
| **Total request units**    | Total observed RU consumed in the period. This is usage volume, not RU/s or your configured throughput.                              |
| **Metadata requests**      | Total observed metadata/control-plane requests, a separate metric from Total requests.                                               |
| **Server-side latency**    | Highest observed bucket average, taking the higher of Direct and Gateway latency. It is not a client round-trip time or p99 latency. |
| **Service availability**   | Latest available account-level availability reading. It is not an average calculated by Overview over the selected period.           |
| **Data + index usage**     | Data and index storage in the newest observed chart bucket, including a partial reading when only one component is available.        |
| **Provisioned throughput** | Latest observed provisioned RU/s. This is different from the account's total throughput limit.                                       |
| **Document count**         | Latest combined snapshot from collections that reported observations; not the number of documents created during the period.         |

Charts normally use one-minute buckets for 1 hour, five-minute buckets for 24 hours, and hourly buckets for 7 days.
Some metrics are coarser: storage, throughput and document count start at five minutes;
service availability uses hourly readings. A wider window can therefore smooth short spikes.
Tile values may be rounded; thresholds use the underlying values.

**State** tiles describe stored or provisioned state. **Activity** tiles describe request activity.
These groups help explain why some readings remain visible on an idle account while others are blank;
they do not guarantee that Azure has returned every expected sample.

### Shaded throttling periods

Normalized RU and Total requests charts can mark periods with sustained 429s.
These overlays follow the selected **chart scope, period and bucket size**.
The account health badge uses its separate account-wide, one-minute check.
Consequently a chart band and the health badge can differ without contradicting each other.
If overlay collection fails, the main chart can still be shown without bands.

### Storage: data, indexes and partial readings

The storage chart shows **Data** as a solid line and **Indexes** as a dashed line.
Its point details explain what was observed for each component.

- Both readings available: the tile can show their total.
- Only one available: the tile shows the available amount with **Partial data**. It is not the full storage size.
- Neither available: a dash replaces the number.

A missing component is never silently treated as a measured zero. Missing chart buckets remain gaps.
For example, a 2 GB data reading with indexes unavailable means “at least the observed 2 GB,” not “2 GB total.”
The tile uses the newest observed bucket rather than showing an older complete total as if it were current.

The inventory table uses each component's latest observation over seven days.
Monitoring uses the selected scope/period and aligns components at the same timestamp.
Azure's aggregation and collection coverage also differ, so these views are **not guaranteed to match exactly**.
Current byte labels use binary sizes: for example, a displayed GB uses 1,024³ bytes.

### Serverless accounts

**Normalized RU** and **Provisioned throughput** tiles are hidden because Serverless has no provisioned RU/s.
The inventory also hides Throughput, Peak normalized RU and the throughput-mode filter.
The account header and details omit Total throughput limit; Capacity mode still identifies Serverless.
The first chart is **Total request units** instead of Normalized RU.
Partition investigation shows **Storage distribution**, without an RU/Storage switch.
Request counts, consumed RU and account-wide throttling remain useful on Serverless.

### No data is not zero

| Display                             | How to interpret it                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| **0**                               | A numeric zero was observed.                                                                |
| **No data**                         | No usable result is available. It does not establish that the account is healthy or unused. |
| **Not applicable**                  | The metric does not apply to this capacity mode.                                            |
| **Not supported**                   | This source/view is not supported for the account/API.                                      |
| **No permission / Access required** | Your Azure identity cannot read the source at the required scope.                           |
| **Unable to load**                  | The metric request failed; retry or investigate access/connectivity.                        |
| **Partial data / Partial coverage** | Some readings or checks succeeded, but the result is incomplete.                            |

Some older data sources also use No data for request failures. If the result is unexpected, try Refresh,
check the account in Azure Portal, and use **Show Output** where diagnostic details are offered.

## Databases and Containers

Use the inventory table to search, filter and sort containers. Critical containers come first even when sorting
another column; pagination shows 25 containers per page. The table scrolls within the panel.
Container actions let you locate a resource in Explorer or open its query editor.

The main measurements are:

- **Peak RU:** highest normalized RU in the selected chart period.
- **Storage:** latest observed data plus index storage, with partial-data details.
- **Data growth:** latest minus first observed **data** size over seven days. Index growth is not included.
- **Document count:** latest observed count for the container, not a live data-plane count.

### Container throttling

The **Throttling** column is a scoped diagnostic, not an overall container-health assessment.
For **Provisioned** containers, the default thresholds are Critical at a normalized RU peak of **90% or more**
or sustained 429s, and Needs Attention at a peak of **80% or more**. Lower observed RU gives Passed.
For **Serverless**, normalized RU is not required: usable request observations without sustained 429s give Passed,
sustained 429s give Critical, and missing observations or a failed request check give Unknown.

Sustained 429s mean **more than 1% of all requests** for **at least five minutes** in the last hour, not an absolute
number of 429s. Observed zero counts are usable observations; an empty response is not.
Container 429 checks use the last hour even when Peak RU uses another period.
Storage growth does not directly change this assessment. Consumed RU remains useful for Serverless cost and load
analysis, but is not a percentage of available capacity.

Missing metric health normally shows Unknown.
There is a current limitation: a provisioned row with no metric result at all can retain its initial Passed label.
Use the account checklist's unassessed count and the actual metric values rather than treating that row label
as proof that telemetry was collected.

### Physical-partition distribution

Select a container in the partition section; this selection is independent of the header database filter.

**RU mode** shows each partition's p99 normalized utilization in the selected period.
P99 is a high-end value that is less sensitive to one isolated spike than a maximum.
The percentage is that partition's utilization, **not its share of all account RU**.
A partition is flagged hot when it reaches at least 90% while another is below 70%.
If all partitions are busy, this is not classified as uneven distribution; it may instead indicate insufficient throughput.

**Storage mode** compares partition sizes. With default settings, a partition is flagged when it has at least
1 GiB and the smallest sibling is less than 70% of its size.
Its percentage is a share of the observed partition-size peaks, not a share of the account's capacity limit.
The view uses physical partitions, not individual logical partition-key values.

## Advisories and alerts

### Derived Advisories: investigations suggested by the extension

These findings help you investigate hot partitions, throttling, uneven or growing storage, indexing overhead,
unused or oversized throughput, possible capacity-mode changes, expensive configuration choices,
query fan-out and shared-throughput contention.

Open a finding for its evidence and suggested action. Shared guidance appears before resource-specific details.
Dismissal hides that finding in the current dashboard; it does not fix the resource or dismiss an Azure alert.
Dismissals survive Refresh but reset when the dashboard is remounted.

**High / Medium / Low ranks the finding; it does not directly set account health.**
Some checks use seven days of history, others 30 days, while log-based checks use 24 hours.
Changing the chart period does not change those diagnostic windows.
For example, a quiet last hour can coexist with a recommendation based on a burst earlier in the month.

Recommendations are heuristics, not automatic changes, guaranteed savings or proof that a proposed RU target is legal.
Validate workload requirements, current Azure limits and migration constraints before acting.
Some minimum-throughput cases can currently suggest no actual reduction; check the before/after values.
**Partial coverage** means successful findings are still useful but some checks could not run.
No findings does not prove that every resource was checked or that no problem exists.

Certain query/ingestion checks need resource-specific diagnostic logs in Log Analytics.
Without those logs or access to them, other available checks still run. See [Permissions](#permissions).
Advanced thresholds can be found in VS Code Settings under `cosmosDB.accountOverview`;
the numbers in this guide are defaults.

### Azure Advisor recommendations

These are recommendations from Azure, separate from the extension's derived findings.
Only **High-impact Performance or Cost** recommendations raise account health to Needs Attention.
Refresh may reuse an Advisor response collected in the last 55 seconds; it does not ask Azure to rerun its analysis.

### Azure Monitor alerts

The list has **Active** and **Resolved** modes plus **1h / 1d / 7d / 30d** periods.
It starts with Active over 1 day. **View in Azure portal** opens the individual alert;
**Open alerts in Azure portal** opens the account's Alerts page.
Each period displays its matching count in parentheses. Switching Active/Resolved switches these counts too.
Resource Graph calculates all period counts in one aggregate query, without downloading alerts to count them.
Periods are nested lookback windows based on when an alert started and its current condition, not when it resolved.
Azure Monitor retains alert instances for 30 days; the dashboard does not imply 60/90-day coverage.
After a filter change, assistive technology announces the matching aggregate count, not the loaded row count.
Unavailable counts display a dash rather than zero. Counts and details can differ temporarily due to source propagation.

**Active means the alert condition is Fired. It does not mean the incident workflow is New or unclosed.**
Azure's New/Acknowledged/Closed workflow state is a separate field, and Overview does not filter or change it.

The account-wide summary checks retained Fired alerts independently of the list's time filter.
For example, an alert outside the selected one-day list can still contribute to health.
Conversely, switching the list to Resolved does not make resolved alerts affect health.
Sev0/Sev1 raise health to Critical; Sev2/Sev3 raise it to Needs Attention; Sev4 does not raise it.

The summary is limited by Azure retention, your access and propagation delays.
A Closed-but-Fired alert can still affect current health.
There is not yet a separate notification specifically for unclosed active incidents.

## Refresh and timestamps

Overview loads when opened. It does not refresh on a timer or just because you return to the editor.
**Refresh** reloads all sections and waits for them to finish, including failures.
While data is loading, affected selectors and Refresh cannot start another update; your selected values are retained.

Changing the chart period reloads charts, inventory RU metrics and the selected partition view.
Changing the header database reloads charts only.
Alert-list filters reload only the list, not the account-wide alert summary.
Switching tabs does not reload data.

**Charts generated at** shows when the displayed chart batch was produced, in local time.
It does not describe every section's freshness or when Azure observed the latest sample.
Azure Monitor ingestion delays and different collection windows can explain differences from Portal or another section.

## Account actions and capacity

**Add database** and **Add container** use the existing native VS Code wizards for this account.
With All databases selected, Add container asks you to choose a database in the same account.
Overview is dimmed while a creation wizard runs. Cancel returns without changes; successful creation refreshes inventory.
Delete account uses the existing confirmation and requires permission to delete the resource.

**View Cost** opens account-scoped Azure Portal Cost Analysis.
**View JSON** opens the ARM account resource as formatted JSON; it does not retrieve account keys or connection strings.
**Try Data Modeler** opens the modeler for this account without an account picker.
It requires AI features enabled and available GitHub Copilot models.

**Capacity mode** and **Total throughput limit** are different:

- Capacity mode tells you whether the account is Serverless or uses provisioned throughput.
- Total throughput limit caps the RU/s that can be allocated across throughput-bearing resources.
  It is not current usage or an estimate of available performance.

For provisioned accounts, **No total throughput limit** means the account-wide cap is disabled.
An explicit **0 RU/s** is not the disabled value; **Unknown** means the cap metadata is absent.
Serverless hides Total throughput limit because a provisioned-throughput allocation cap does not apply.
Disabling an account cap does not remove per-resource throughput or service limits.
See [Limit total account throughput](https://learn.microsoft.com/azure/cosmos-db/limit-total-account-throughput).

## Permissions

Overview uses your signed-in Azure identity. The following are typical role assignments;
equivalent custom-role permissions and assignment scope can also determine access.
Missing access to one source does not grant or remove access to another.

| Source                                              | Typical read access                                           |
| --------------------------------------------------- | ------------------------------------------------------------- |
| Account properties, inventory and throughput offers | Reader on the account or a containing scope                   |
| Monitor metrics and alerts                          | Monitoring Reader at the relevant scope                       |
| Azure Advisor subscription read                     | Reader on the subscription                                    |
| Log-based derived checks                            | Log Analytics Reader or equivalent effective log-query access |

Log-based checks additionally require **DataPlaneRequests** and **QueryRuntimeStatistics** sent to Log Analytics
in **resource-specific** mode. Legacy AzureDiagnostics tables are not used by these checks.
Log collection and permission to query the logs are separate requirements.
Creating/deleting resources requires the corresponding Azure write permissions.

See [Azure RBAC](https://learn.microsoft.com/azure/role-based-access-control/overview) and
[Log Analytics access control](https://learn.microsoft.com/azure/azure-monitor/logs/manage-access).

## Keyboard use

Use Tab to reach controls and focusable badges. Focus a health/metric badge for its explanation.
Use Left/Right to move between tab labels, then Enter or Space to activate.
Sortable table headers support Enter/Space; pagination and filters expose their selected values.
Loading controls remain in the keyboard focus order but cannot start duplicate requests.

Labels and explanations accompany color indicators. However, complete screen-reader access to individual chart values
and an exact-data table alternative are not yet established; do not rely on chart color alone to investigate an issue.
