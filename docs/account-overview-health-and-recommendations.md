# Account Overview Preview: Health and Recommendations

This document describes the current Preview implementation as of September 24, 2026.
It explains the product behavior, not a complete Cosmos DB health assessment or a promise that every
design-mockup value is available. Original retains its separate source-based presentation.

## Short explanation for stakeholders

> **Account health** highlights detected workload problems and risks that deserve investigation.
> **Prioritized recommendations** highlights opportunities to improve capacity, cost, or configuration.
> Both use existing account data. Our own checks contribute to both sections; Azure Monitor alerts
> contribute to Health, and Azure Advisor guidance contributes to Recommendations.
> Findings are evidence-based signals, not automatic remediation or guarantees of future improvement.

## At a glance

|                                  | Account health                                                      | Prioritized recommendations                          |
| -------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| Main question                    | What problems or risks have we detected?                            | What could we improve?                               |
| Our derived checks               | 11 detector types                                                   | 7 detector types                                     |
| Additional Azure source          | Active Azure Monitor alerts                                         | Azure Advisor recommendations                        |
| Compact summary                  | First 3 severity-ranked issue groups                                | First 3 importance-ranked individual recommendations |
| Full list                        | All returned, undismissed Health findings, without summary grouping | All returned, undismissed recommendations            |
| Main action                      | View all alerts                                                     | View all recommendations                             |
| Automatically changes resources? | No                                                                  | No                                                   |

**18 is the number of implemented derived detector types, not the number of findings in an account.**
A detector can produce findings for multiple resources, produce one account-wide finding, or produce none.
Azure Monitor and Advisor can add further items; their types are not limited to our 18 detectors.

## 1. Account health

Health includes the following 11 derived detector types and active Azure Monitor alerts.
Descriptions below summarize the checks. Exact firing conditions, supported inputs, lookbacks and
suppression rules belong to the detector implementation and the evidence shown in full details.

| Check                          | Rule ID                       | What the signal means                                                                                                                                                   |
| ------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hot partitions                 | `HotPartitionRisk`            | Partition-level RU pressure is uneven: a hot partition has less headroom than its peers.                                                                                |
| Sustained throttling           | `SustainedThrottlingInRegion` | Capacity pressure and throttling indicate that provisioned throughput may not meet demand.                                                                              |
| Storage growth risk            | `StorageGrowthRisk`           | Observed physical-partition growth projects reaching the storage split ceiling within the configured risk horizon. This is a trend estimate, not a guaranteed deadline. |
| Storage skew                   | `StorageSkewRisk`             | Data is distributed unevenly across physical partitions.                                                                                                                |
| Indexing cost risk             | `IndexingCostRisk`            | Index storage relative to data suggests the indexing policy may be unnecessarily expensive.                                                                             |
| Expensive consistency          | `ExpensiveConsistency`        | The consistency configuration can increase read RU cost; changing it requires checking application consistency requirements.                                            |
| Multi-region write antipattern | `MultiRegionWriteAntipattern` | The configuration appears to enable multi-region writes where their benefit may not apply or be justified. The detailed finding explains the detected case.             |
| Cross-partition queries        | `CrossPartitionQuery`         | Query activity fans out across partitions, potentially increasing RU use and latency.                                                                                   |
| Partition key misalignment     | `ShardKeyMisalignment`        | Query filters do not align with the partition key, preventing efficient partition targeting.                                                                            |
| Uncontrolled ingestion         | `UncontrolledIngestion`       | Write-heavy activity is associated with throttling, suggesting ingestion needs pacing or capacity review.                                                               |
| Shared-throughput starvation   | `SharedThroughputStarvation`  | Containers contend for shared database throughput.                                                                                                                      |

### Why do some cost-related checks remain in Health?

The split is a **Preview presentation decision**, not an Azure taxonomy. The current mapping treats
indexing cost, consistency cost and multi-region-write configuration risks as diagnostic findings.
The seven explicitly listed capacity/resource optimization checks below go to Recommendations.
Each derived rule has exactly one destination; the same finding is not copied into both sections.

### Azure Monitor alerts

These are existing, fired Azure Monitor alerts returned for the account and selected alert window.
They are not Azure Advisor recommendations, and the extension does not create alert rules.

The extension maps Azure severities as follows:

| Azure severity | Displayed alert severity |
| -------------- | ------------------------ |
| Sev0 / Sev1    | Critical                 |
| Sev2 / Sev3    | Warning                  |
| Sev4           | Informational            |

Our derived findings retain their own **High / Medium / Low** labels. They are not relabeled as Azure
alerts. The **View all alerts** button opens the complete Health dialog, which contains both sources
and identifies their provenance.

### Ordering, grouping and counts

- Ranking places Critical first, then Warning/High, then Medium, then Informational/Low.
- The compact Health table groups derived findings by detector rule across resources. Azure alerts
  group only when an explicit matching alert-rule identity is available.
- A group's most severe member determines its severity. Groups are dynamic; only the first three
  are displayed in the compact table.
- The header counts **individual findings before grouping**, not displayed rows. It excludes
  Recommendations, session-dismissed derived findings and alerts from an outdated alert window.
- Header warning totals include the High/Medium derived findings ranked into the warning band;
  they are not a count exclusively of Azure Monitor Warning alerts.
- An affected-resource cell shows the first scope. Multiple derived scopes use **+ others** because
  bounded scans do not establish a complete affected-container count.
- Account-wide and database scopes are not described as containers. Full details retain individual
  scopes and evidence rather than presenting one container's measurements as a group aggregate.

## 2. Prioritized recommendations

Recommendations combines **7 derived optimization detector types** with **Azure Advisor guidance**.
It remains visible below the metrics even when there are no recommendations.

### Our seven optimization checks

| Check                          | Rule ID                       | Opportunity being identified                                                                             |
| ------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Over-provisioned throughput    | `OverProvisioning`            | Review provisioned RU/s that is high relative to observed demand.                                        |
| Autoscale candidates           | `AutoscaleCandidate`          | Consider autoscale for variable or bursty demand currently using manual throughput.                      |
| Idle containers                | `IdleContainer`               | Review unused or nearly unused resources and their ongoing provisioned-capacity cost.                    |
| Partition merge candidates     | `PartitionMergeCandidate`     | Consider whether fewer physical partitions could better fit the resource's throughput and storage needs. |
| Autoscale maximum too high     | `AutoscaleMaxOverProvisioned` | Review the configured autoscale maximum and associated minimum throughput floor.                         |
| Autoscale-to-manual candidates | `AutoscaleToManualCandidate`  | Consider manual throughput for sufficiently steady demand currently using autoscale.                     |
| Serverless candidates          | `ServerlessCandidate`         | Evaluate serverless for intermittent demand, subject to feature, scale and migration requirements.       |

These are candidates for review, not instructions to apply changes blindly. Workload growth,
availability requirements, scheduled peaks and application constraints can justify retaining the
current configuration. Exact eligibility is determined by the individual detector.

### Azure Advisor guidance

Azure Advisor is a separate Azure service. The extension reads existing recommendations at subscription
scope, then keeps those whose resource ID matches the account or one of its child resources.
It does not run Advisor's recommendation-generation process.

All returned Advisor recommendations that pass this resource/text filtering remain in Recommendations,
including reliability and security guidance. **High Advisor impact is not a Critical workload alert.**

Advisor has broad categories such as Cost, Performance, HighAvailability, Security and
OperationalExcellence. These categories are not seven additional fixed detectors in the extension.

Examples of Cosmos DB guidance include:

- Optimizing provisioned RU/s.
- Enabling zone redundancy or reviewing multi-region capabilities.
- Considering continuous backup.
- Reviewing indexing, SDK usage or supported service versions.

Availability depends on the service's evaluation and the resource. The
[Cosmos DB automated recommendations documentation](https://learn.microsoft.com/azure/cosmos-db/automated-recommendations)
also notes that the Cosmos DB portal pane and Azure Advisor do not expose exactly the same recommendations.

### What Advisor data reaches our UI today?

| Information                         | Current behavior                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem and suggested solution      | Preserved when supplied. Some responses use identical text for both.                                                                                                                  |
| Category and High/Medium/Low impact | Preserved and used for display/ranking.                                                                                                                                               |
| Recommendation ID                   | Preserved for identity.                                                                                                                                                               |
| Potential monetary benefit          | Extracted from selected savings properties when supplied.                                                                                                                             |
| Documentation link                  | Preserved when supplied; not every response contains one.                                                                                                                             |
| Detailed resource scope             | Used to associate the recommendation with the account, but not preserved as a structured UI scope. The UI explicitly says detailed resource scope is not provided.                    |
| Additional evidence                 | Azure may return database/container names, region, current/recommended RU/s, observation dates or other type-specific properties. Most are not passed through by the current adapter. |

The current monetary-benefit adapter prefers `annualSavingsAmount`, falling back to `savingsAmount`,
and includes the currency when supplied. It does **not** preserve a structured time period in the UI
contract. Therefore the current displayed benefit must not be described generically as monthly savings.
Presenting richer, period-labeled Advisor evidence requires extending the adapter and UI contract.

## 3. Estimated impact: what we can and cannot claim

The Preview provides qualitative potential effects for known derived rules, for example:

- "May reduce hot-partition throttling."
- "May reduce write RU and index storage."
- "May reduce unused throughput costs."

These are explanations of why an action may help, **not measurements, forecasts or guarantees**.
For arbitrary Azure Monitor alerts, the extension does not infer an effect from the alert name;
unknown effects are shown as **Not estimated**.

Advisor-reported monetary benefits are separate from these qualitative descriptions and retain their
Advisor attribution. They are not calculated by our derived detectors.

The implementation does not invent confidence percentages, expected latency improvements, or claims
such as "reduce throttling by 70%" simply because they appear in a design mockup.

## 4. Availability, scope and dismissal

| Source dependency                    | Health | Recommendations                                      |
| ------------------------------------ | ------ | ---------------------------------------------------- |
| Derived metrics/configuration checks | Yes    | Yes                                                  |
| Log-based derived checks             | Yes    | No: the seven optimization checks use non-log inputs |
| Azure Monitor alerts                 | Yes    | No                                                   |
| Azure Advisor                        | No     | Yes                                                  |

Missing access, disabled logs, loading and unavailable sources are shown through source-specific pills.
The pills expose explanations and applicable documentation or refresh actions. Available findings remain
visible even when another source cannot be read.

Typical access guidance is Monitoring Reader for metrics/alerts, Log Analytics Reader for log-based
checks, and Reader on the subscription for Advisor.

**An empty section does not prove the account has no problems or optimization opportunities.**
Possible reasons include no returned findings, unmet detector conditions, unavailable inputs,
session dismissals, or Advisor configuration exclusions. The current UI does not query Advisor's
exclusion configuration separately; it cannot distinguish that cause from other successful empty responses.
See [Advisor subscription/resource-group configuration](https://learn.microsoft.com/azure/advisor/view-recommendations).

Findings use source-specific lookbacks rather than the chart's time window or selected database scope.
The Health dialog exposes a separate Azure alert window. Some scans are bounded, so the full list means
all findings returned by the current checks, not an exhaustive analysis of every possible issue.

Derived findings can be dismissed for the current session from either full-list dialog. This does not
fix the condition or dismiss anything in Azure. Each dialog reports its category's known dismissed
findings. Azure Advisor and Azure Monitor items are not dismissed through that derived-findings action.

## 5. Frequently asked questions

**Are Health and Recommendations different data pipelines?**

No. Both presentations share the account-overview state and fetching lifecycle. Preview categorizes
existing findings by meaning; it does not start a separate detector engine.

**Can a problem and a recommendation describe related concerns?**

Yes. Different sources can independently report related issues. The extension does not merge
Azure Advisor and derived evidence just because their titles or topics are similar.

**Does the Health table represent Azure Resource Health or an SLA?**

No. It is a workload-diagnostics summary, not an Azure Resource Health feed, availability guarantee
or comprehensive incident assessment. The ARM provisioning-status display is also a separate concept.

**Why can there be more findings than rows?**

Health summarizes multiple resource findings into issue groups, and both compact sections are limited
to three rows. Full-list dialogs expose the remaining returned items.

**Why can our checks find something when Advisor is empty?**

The extension's detectors and Azure Advisor evaluate independently, with different inputs, conditions
and evaluation schedules. Advisor can also be excluded for a subscription or resource group.

**Does this change Original?**

No. This classification is specific to Preview. Original retains its existing source-based blocks.

## Implementation references

- [Preview rule mapping, ranking, grouping and category state](../src/webviews/cosmosdb/AccountOverviewV2/overviewFindingsModel.ts)
- [Preview tables and full-list content](../src/webviews/cosmosdb/AccountOverviewV2/OverviewFindings.tsx)
- [Source availability pills](../src/webviews/cosmosdb/AccountOverviewV2/OverviewCoverage.tsx)
- [Derived detector registry](../src/panels/accountOverview/services/advisories/registry.ts)
- [Individual detector implementations](../src/panels/accountOverview/services/advisories/detectors)
- [Azure Monitor and Advisor adapter](../src/panels/accountOverview/services/alertsRecommendations.ts)
- [Dashboard documentation](account-overview-dashboard.md)
