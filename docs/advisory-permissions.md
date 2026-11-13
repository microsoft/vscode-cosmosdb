# Permissions for Account Overview Advisories

Reviewed on **November 12, 2026**.

This document covers read-only access to the **Advisories** tab for Azure Cosmos DB for NoSQL:
extension-generated advisories, Azure Advisor recommendations, Azure Monitor alerts and alert counts.
It maps the extension's current API calls to Azure permissions and explains which role guidance the UI can provide.
The current implementation reports source-specific read failures in the UI and in sanitized local Output.
Known Log Analytics client-acquisition authentication/access failures retain their cause in partial coverage.
Failure summaries distinguish source, category and reason, so incomplete data cannot hide permission guidance.
Scoped metric diagnostics mask database/container identities, including all known members of a shared offer,
within the current invocation only.

## Practical role guidance

A broad read-only profile is **Reader or Monitoring Reader on the subscription containing the Cosmos DB account**.
These roles are alternatives; users do not need both.
Workspace access may also be necessary, depending on the Log Analytics access-control mode and table permissions.

This is a broad profile, **not a verified least-privilege minimum**.
Account-scoped Reader covers account configuration, inventory, metrics and, under the conditions described below,
resource-context logs. Microsoft's documentation also supports target-resource read access for Advisor and alerts.
However, account-only access has not been established as sufficient for the extension's Activity Log fallback
and Resource Graph alert-count query. Do not promise full coverage from account-scoped Reader alone.

Equivalent custom roles can grant the required permissions at the appropriate scopes.
The built-in role names are examples, not uniquely mandatory assignments.
Parent-scope assignments are inherited: subscription-scoped Reader makes a separate account-scoped Reader redundant.

Sources: [Azure built-in roles][roles], [Azure Monitor access][monitor-access],
[Advisor permissions][advisor], [Resource Graph access][resource-graph].

## Required read permissions by source

The permissions in this table are Azure RBAC **Actions**. Log Analytics granular **DataActions** are discussed separately.

| Source                                    | Permission                                                                                              | Scope and role guidance                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Account configuration and NoSQL inventory | Five `Microsoft.DocumentDB/.../read` actions listed below                                               | Reader on the account or an inherited parent scope                                                                                     |
| Azure Monitor metrics                     | `Microsoft.Insights/Metrics/read`                                                                       | Reader or Monitoring Reader on the account                                                                                             |
| Activity Log: container-age fallback      | `Microsoft.Insights/eventtypes/values/Read`                                                             | Subscription-scoped Reader or Monitoring Reader is the broad profile; a narrower minimum is not established here                       |
| Resource-context diagnostic logs          | `Microsoft.Insights/logs/*/read`, or table-specific resource log permissions for the queried CDB tables | Reader on the account normally covers this when resource permissions are enabled; workspace restrictions may require additional access |
| Azure Advisor recommendations             | `Microsoft.Advisor/recommendations/read`                                                                | Read access to the associated resource; Reader on the account or an inherited parent scope                                             |
| Azure Monitor alerts                      | `Microsoft.AlertsManagement/alerts/read`                                                                | Read access to the target resources; Reader or Monitoring Reader                                                                       |
| Resource Graph: alert counts              | `Microsoft.ResourceGraph/resources/read` and read access to the queried alert resources                 | Subscription-scoped Reader or Monitoring Reader is the broad profile; account-only sufficiency is not established here                 |

### Account configuration and NoSQL inventory

The extension reads the account, databases, containers and throughput settings through the ARM management API:

```text
Microsoft.DocumentDB/databaseAccounts/read
Microsoft.DocumentDB/databaseAccounts/sqlDatabases/read
Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/read
Microsoft.DocumentDB/databaseAccounts/sqlDatabases/throughputSettings/read
Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/throughputSettings/read
```

Throughput-setting reads are skipped for serverless accounts.

### Activity Log and Resource Graph scope caveats

The extension queries Activity Log when a container's `systemData.createdAt` is unavailable.
The fallback searches roughly the preceding 89 days for container write events.
Azure Activity Log's default retention is 90 days; missing historical events are not necessarily an authorization issue.

The Resource Graph query reads the `alertsmanagementresources` table.
Those alert objects are not simply children of the Cosmos DB account.
Generic documentation stating that Resource Graph requires read access to queried resources does not establish
that Reader on the Cosmos DB account alone authorizes this specific query.

For these two sources, subscription-scoped Reader or Monitoring Reader is the broad recommendation.
This document does not claim that subscription scope is the narrowest possible assignment,
or that resource-group scope is sufficient for every call.

Permission sources: [DocumentDB permissions][database-permissions], [Monitor permissions][monitor-permissions],
[Resource Graph permissions][management-permissions].
Scope and retention sources: [Azure Monitor access][monitor-access], [Advisor permissions][advisor],
[Resource Graph access][resource-graph], [Activity Log REST API][activity-api], [Activity Log retention][activity-log].

### Optional financial estimates

The broad read-only profile above does not guarantee billing access. Throughput cost estimates use an account-filtered
Cost Management query; Cost Management Reader or equivalent billing access may be required.
Backup estimates instead combine resource storage metrics with public retail prices.
Unavailable billing, pricing or complete storage evidence does not hide capacity/configuration findings, does not
become zero cost, and does not change metric/log coverage. The separate cost notice preserves its categorized reason,
including rate limiting after the existing SDK retry budget is exhausted.

## Log Analytics access

The extension calls `LogsQueryClient.queryResource` with the Cosmos DB account ARM ID.
It queries these tables independently:

- `CDBDataPlaneRequests`
- `CDBDataPlaneRequests5M`
- `CDBQueryRuntimeStatistics`

Request-log checks prefer `CDBDataPlaneRequests5M` and fall back to `CDBDataPlaneRequests` only when the aggregate
table is explicitly missing. Query-runtime structural checks use `CDBQueryRuntimeStatistics` independently.
Optional query-RU enrichment also requires raw `CDBDataPlaneRequests`.
Coverage requires access to the tables used by the checks and the relevant records for the account.
Access to one table does not imply access to the other under custom or granular permission policies.

### Use resource or workspace permissions

When the destination workspace uses **Use resource or workspace permissions**, resource-context queries can be
authorized through read permissions on the Cosmos DB account.
Standard Reader or Monitoring Reader covers `Microsoft.Insights/logs/*/read`.
An additional Log Analytics Reader assignment is not normally required.

A legacy, table-specific custom-role alternative is:

```text
Microsoft.Insights/logs/CDBDataPlaneRequests/read
Microsoft.Insights/logs/CDBDataPlaneRequests5M/read
Microsoft.Insights/logs/CDBQueryRuntimeStatistics/read
```

These are alternatives to the wildcard, not additional permissions required alongside it.
Custom role exclusions can affect individual tables.

A workspace in a different subscription does not, by itself, require extra workspace permissions
when resource-context access is allowed.

### Require workspace permissions

When the workspace uses **Require workspace permissions**, account-level read access alone is not sufficient.
The caller also needs suitable workspace access, for example **Log Analytics Reader on the destination workspace**.
If an existing Reader assignment already covers that workspace, an extra Log Analytics Reader assignment may be redundant.

Workspace authorization supports `Microsoft.OperationalInsights/workspaces/query/read`
and legacy per-table permissions such as:

```text
Microsoft.OperationalInsights/workspaces/query/CDBDataPlaneRequests/read
Microsoft.OperationalInsights/workspaces/query/CDBDataPlaneRequests5M/read
Microsoft.OperationalInsights/workspaces/query/CDBQueryRuntimeStatistics/read
```

These are conditional authorization options, not a cumulative permission checklist for every resource-context query.

### Granular or table-level RBAC

**Log Analytics Data Reader** provides these role permissions:

```text
Actions:
  Microsoft.OperationalInsights/workspaces/query/read
  Microsoft.OperationalInsights/workspaces/read

DataActions:
  Microsoft.OperationalInsights/workspaces/tables/data/read
```

The table-data DataAction supports granular conditions.
Any conditions must allow the queried CDB tables and the relevant rows for this account.
Log Analytics Reader is a different role: its broad read Actions are not equivalent to a conditioned Data Reader assignment.

Sources: [Manage access to Log Analytics workspaces][log-access], [Log Analytics role definitions][monitor-roles].

## Data collection prerequisites

Permissions alone do not ensure that every advisory can run or produce a finding.

Configure diagnostic settings to export **DataPlaneRequests5M** (or **DataPlaneRequests**) and
**QueryRuntimeStatistics** to Log Analytics
in **resource-specific / Dedicated mode**, which produces the CDB tables the extension queries.
Exporting only to the legacy `AzureDiagnostics` table does not satisfy the current queries.

Configuring diagnostic settings is a separate administrative operation.
It requires `Microsoft.Insights/diagnosticSettings/write` on the Cosmos DB account and appropriate destination access.
These setup permissions are **not required merely to view advisories** once logging is configured.

**Full-text query logging is not required by the current detectors.**
They work with anonymized query shapes and request/partition fan-out observations.
Do not recommend enabling full-text logging as a permission or advisory prerequisite.

Even with full read access, coverage can remain partial because required tables are missing,
metrics are unavailable, historical Activity Log events have expired, or a detector is not applicable to the account.
Accessible log tables with no data in the analysis window skip only their dependent checks without reporting a read failure.
An empty request-log table does not suppress independent query-runtime checks.
An empty result does not establish that a role is missing.

Sources: [Cosmos DB resource logs][cosmos-logs], [Supported Cosmos DB log categories][supported-logs],
[Activity Log retention][activity-log].
The table names, resource-specific query requirement and anonymized-query behavior above describe the current extension.

## Permissions that are not required for viewing

- Native **Cosmos DB Built-in Data Reader** or **Cosmos DB Built-in Data Contributor** roles.
- Cosmos DB account keys or connection strings.
- Owner or Contributor solely to read advisories.
- `Microsoft.Insights/MetricDefinitions/read` solely for this collector: it does not perform metric-definition discovery.
- `Microsoft.Insights/diagnosticSettings/read` solely for this collector: it probes the log tables rather than enumerating settings.
- Diagnostic-setting writes or full-text query logging.

This does not describe permissions needed for separate operations such as querying documents,
changing throughput, creating resources or modifying diagnostic settings.

## Current user-visible behavior when permissions are missing

Account Overview shows a shared **Some account data could not be loaded** warning across its tabs.
It identifies failed sources and provides **Show Output** and **Learn more about Azure roles** actions.
Authorization failures include permission identifiers, example read-only roles and assignment-scope guidance.
Authentication failures instead ask users to check Azure sign-in, tenant and credentials.
Successful reads and advisory findings remain available.

Read-failure and partial-coverage notices are collapsed by default. Their titles and informational/warning styling
remain visible; expand a notice to review skipped checks, failure details and permission guidance.
**Show Output** and guidance links remain available while details are collapsed.
Actual advisory findings are not hidden by these diagnostic disclosures.
Cost-evidence failures retain a separate collapsed **Some cost estimates are unavailable** notice.
They do not mark workload metrics or log coverage as failed, and successful recommendations and billing provenance remain visible.

This covers collection after the dashboard has account metadata, including Monitoring and inventory reads.
Failures while initially opening the dashboard remain outside this table.

| Failure source                                              | What the user sees in the UI                                                                                                                                                            | What is written to Output                                                                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Diagnostic-log query or table probe                         | The shared warning names Log Analytics and explains resource/workspace permissions. The advisory card retains its detailed **Partial coverage** notice and per-operation categories.    | Query/probe diagnostics include operation, category, HTTP status, service codes, sanitized messages and request ID where available.                                            |
| Log Analytics client acquisition                            | The shared warning distinguishes access denial, authentication and client unavailability.                                                                                               | Acquisition failures are logged with available SDK details; a missing client is also reported explicitly.                                                                      |
| Metrics, including advisory inputs and best-effort overlays | The shared warning names **Azure Monitor metrics** and the account-scoped read permission. Derived advisories also retain **Incomplete workload analysis** and affected analyzer names. | The failing metric request is reported before a service catches it or returns partial data.                                                                                    |
| Account, inventory or throughput reads                      | The shared warning distinguishes **Account configuration** from **Inventory and throughput**, with ARM read permissions and account-scope guidance.                                     | The failing ARM operation is reported. Expected missing throughput offers (404) are not treated as permission failures.                                                        |
| Activity Log container-age fallback                         | The shared warning names **Azure Activity Log**, its read permission and the broad subscription-scoped role option. Affected advisory checks remain marked incomplete.                  | Iterator failures are logged as Activity Log failures, not mislabeled as metrics.                                                                                              |
| Azure Advisor recommendations                               | The shared warning names **Azure Advisor recommendations** and associated-resource read access. The section retains its unavailable state.                                              | The service logs the SDK error before returning its unavailable result.                                                                                                        |
| Azure Monitor alert list                                    | The shared warning names **Azure Monitor alerts** and associated-resource read access. The section retains its unavailable state.                                                       | The service logs the SDK error before returning its unavailable result.                                                                                                        |
| Resource Graph account-wide alert counts                    | The shared warning names **Resource Graph alert counts** and the relevant permissions/scope guidance. The filtered list remains independent; unavailable filter counts show a dash.     | HTTP status, Resource Graph service errors and request ID are reported where available. Earlier known alert problems are retained while the latest diagnostic remains visible. |

Role guidance describes alternatives, not uniquely mandatory assignments.
The existing per-section empty states also label their role suggestions as broad options.

### Partial coverage without a service error

**Incomplete workload analysis** can appear even when every HTTP request succeeds.
For example, empty or unusable physical-partition metric series prevent sustained-throttling and hot-partition checks.
That does not establish a request failure or missing permissions, so it does not create the shared read-failure warning.
Missing metric data or unsupported checks without read-error diagnostics use an informational notice.
Request failures, authentication/access failures and mixed outcomes retain warning styling, even when the legacy reason
is `noData`. Log Analytics failures retain their separate warning and do not change the severity of empty metric data.

The metric coverage notice has its own **Show Output** action.
Output records each skipped rule and reason, aggregated across affected resources without including resource names.
These coverage entries are separate from SDK error diagnostics and do not invent an HTTP status or authorization error.
Successful checks and their findings remain available.

### What Output contains

The extension's Output channel is named **Azure Cosmos DB**.
Diagnostics are written at warning level. Non-log sources use prefixes such as
`[Account Overview][metrics]` and `[Account Overview][activityLog]`.
Log queries retain the prefix `[Account Overview][Log Analytics]`.
The warning's **Show Output** button opens that channel.
Writing a warning does not automatically open the channel.

For example, a diagnostic can look like this; this is an illustrative line, not a captured customer error:

```text
[Account Overview][Log Analytics] operation=probeDataPlane; scope=resource; reason=rbac; kind=accessDenied; HTTP 403; code=InsufficientAccessError; The provided credentials have insufficient access to perform the requested operation.
```

HTTP status, nested service codes and a request ID are included only when available in the SDK error.
Messages are sanitized and bounded; resource identifiers, known database/container names, credentials,
URLs, query text and payloads are redacted rather than copied wholesale.
Repeated equivalent diagnostics are deduplicated within one collection run.
These detailed diagnostics are local Output information, not telemetry properties.

### Read failures versus RPC failures

The tRPC logger writes failed procedure invocations to Output at warning level.
Successful invocations are logged at debug level, which is normally hidden.

However, a service returning `available: false`, or a derived-advisory result containing partial coverage,
is still a successful RPC response. Source-specific diagnostics are therefore recorded at the failing read boundary,
before services convert errors to unavailable or partial-coverage results.
They do not depend on the RPC logger detecting a thrown exception or on enabling debug logging.

Automatic error toasts are suppressed by the tRPC telemetry wrapper.
Dashboard read failures normally use inline warnings or empty states instead of a native VS Code error popup.

### Classification and data boundaries

- Sources share nested SDK error classification. HTTP 403 and authorization codes are access failures;
  HTTP 401 and recognized authentication codes are distinguished as sign-in failures.
- The legacy wire reason `rbac` covers both; the bounded diagnostic kind distinguishes authentication from authorization.
- Failed requests remain distinguishable from successful empty responses, even when the legacy unavailable reason is `noData`.
  An unrecognized error still has a warning and Output diagnostic; it is not silently treated as an empty dataset.
- Diagnostic fields in RPC results carry only source/category enums. Raw service messages, HTTP details,
  identifiers embedded in errors and query text are not sent as diagnostics to the UI.
- Each invocation has its own diagnostics, masks and deduplication state, even when clients are shared or reads run concurrently.
- Specific missing-permission information can only be reported when the service returns an error.
  Successful empty or permission-filtered responses do not prove that a role is missing.

Implementation references:

- UI: `src\webviews\cosmosdb\AccountOverview\DerivedAdvisories.tsx`, `DashboardChrome.tsx`,
  `ReadFailureNotice.tsx`, `AccountOverview.tsx` and `ActiveAlerts.tsx`.
- Collection and classification: `src\panels\accountOverview\services\advisories\collect.ts`,
  `src\panels\accountOverview\services\shared.ts` and `alertsRecommendations.ts`.
- Log diagnostics: `src\panels\accountOverview\services\advisories\fetchers\logs.ts`,
  `logsDiagnostics.ts` and `src\panels\accountOverview\logsOutput.ts`.
- Output and fallback wiring: `src\panels\trpc\routers\accountOverview\derivedAdvisoriesRouter.ts`,
  `readData.ts`, `src\panels\accountOverview\services\readDiagnostics.ts`,
  `src\panels\trpc\middleware\outputChannelLogger.ts` and `azextTelemetryRunner.ts`.

## Suggested UI guidance

These messages are proposed improvements, not the current copy listed above.
Show the unavailable source, meaningful read permission, an example role and the relevant assignment scope.
Do not present role names as mandatory when equivalent custom permissions can work.

| Failure source                     | Suggested message                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account configuration or inventory | Access was denied while reading account configuration or inventory. Ask your Azure administrator for Reader on this Cosmos DB account, or equivalent read permissions.                                                                                                                                        |
| Metrics                            | Access was denied while reading Azure Monitor metrics. Ask your Azure administrator for Reader or Monitoring Reader on this Cosmos DB account, or equivalent read permissions.                                                                                                                                |
| Activity Log                       | Access was denied while reading Azure Activity Log. The required permission is Microsoft.Insights/eventtypes/values/Read. Subscription-scoped Reader or Monitoring Reader is a broad option.                                                                                                                  |
| Azure Advisor                      | Access was denied while reading Azure Advisor recommendations. Ask your Azure administrator for Reader on the associated resources, or equivalent recommendation-read permissions.                                                                                                                            |
| Azure Monitor alerts               | Access was denied while reading Azure Monitor alerts. Ask your Azure administrator for Reader or Monitoring Reader on the target resources, or equivalent alert-read permissions.                                                                                                                             |
| Resource Graph alert counts        | Access was denied while querying alert counts. Read access to Resource Graph and the queried alert resources is required. Subscription-scoped Reader or Monitoring Reader is a broad option.                                                                                                                  |
| Diagnostic logs                    | Access was denied while querying diagnostic logs. Check resource log permissions and the workspace access-control mode. Log Analytics Reader on the destination workspace may be required. Allow the CDB tables used by the failed checks, including aggregate/raw request logs and query-runtime statistics. |

Keep authentication, authorization, configuration and no-data states separate:

- **Authentication failure:** ask the user to check Azure sign-in, tenant and credentials, rather than immediately requesting roles.
- **Authorization failure:** show source-specific permission guidance. Other access restrictions may also need investigation.
- **Missing or unavailable log tables:** explain the diagnostic categories, destination workspace and resource-specific mode.
- **Successful empty results:** report that there is no matching data or no findings; do not infer missing roles.

For partial coverage, identify which source or table is unavailable so users know which checks could not run.
Do not promise that assigning a role will recover missing telemetry or expired history.

[roles]: https://learn.microsoft.com/azure/role-based-access-control/built-in-roles
[database-permissions]: https://learn.microsoft.com/azure/role-based-access-control/permissions/databases
[monitor-permissions]: https://learn.microsoft.com/azure/role-based-access-control/permissions/monitor
[management-permissions]: https://learn.microsoft.com/azure/role-based-access-control/permissions/management-and-governance
[monitor-access]: https://learn.microsoft.com/azure/azure-monitor/fundamentals/roles-permissions-security
[advisor]: https://learn.microsoft.com/azure/advisor/permissions
[resource-graph]: https://learn.microsoft.com/azure/governance/resource-graph/overview
[activity-api]: https://learn.microsoft.com/rest/api/monitor/activity-logs/list
[activity-log]: https://learn.microsoft.com/azure/azure-monitor/essentials/activity-log
[log-access]: https://learn.microsoft.com/azure/azure-monitor/logs/manage-access
[monitor-roles]: https://learn.microsoft.com/azure/role-based-access-control/built-in-roles/monitor
[cosmos-logs]: https://learn.microsoft.com/azure/cosmos-db/monitor-resource-logs
[supported-logs]: https://learn.microsoft.com/azure/azure-monitor/reference/supported-logs/microsoft-documentdb-databaseaccounts-logs
