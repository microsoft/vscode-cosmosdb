/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function getVolumetricsTemplateContent(): string {
    return `# Volumetrics

> Fill in the table below with volumetric data for each table or entity in your database.
> This information helps the migration assistant estimate request unit (RU) consumption
> and choose optimal partition keys for Azure Cosmos DB.
>
> Leave cells empty if you don't have estimates — the migration assistant will try to infer missing values.
>
> **Tip:** This file is treated as the primary source for volumetric data during analysis.
> You can also provide additional files (CSV, JSON, AWR reports) alongside this template.
>
> **TPS** = Transactions Per Second — the estimated number of read/write operations per second under normal load.

| #   | Schema  | Table      | Est. Row Count | Avg Row Size (KB) | Growth Rate (month) | Read TPS | Write TPS | Notes                                       |
|----:|---------|------------|---------------:|------------------:|---------------------|---------:|----------:|---------------------------------------------|
| V1  | Sales   | Orders     |     1,000,000  |              2.5  | 10% / month         |      500 |       100 | example; partitioned by customer region     |
| V2  | Sales   | OrderItems |     5,000,000  |              1.2  | 10% / month         |      500 |       100 | example; child of Orders, cascade deletes   |
| V3  | CRM     | Customers  |       200,000  |              3.0  | 5% / month          |      300 |        20 | example; includes address and preferences   |
| V4  | Catalog | Products   |        50,000  |              4.0  | 2% / month          |    1,000 |         5 | example; mostly read-heavy, rarely updated  |

## Workload Notes (optional)

> Use this section to capture **information the source code cannot tell us** — production
> observations and forward-looking intent. The discovery and schema-conversion prompts will
> already infer access-pattern shape (point reads vs queries, CRUD mix) from your source code,
> so the highest-value additions here are real-world traffic data and account-level decisions.
>
> All items below are **optional**, but RU/s and storage estimates improve significantly when
> they are filled in. Add as free-form prose, bullets, or per-table sub-sections — whatever is
> clearest. The schema-conversion prompts read this as plain text.

- **Peak vs. average TPS** — peak-to-average ratio or explicit peak TPS windows
  (e.g. "peak ≈ 5× daily average between 9-11 AM", or "Black Friday = 20× normal").
  When present, estimates are sized against the peak rather than applying a default buffer.
- **TTL / retention per table** — retention policy if any
  (e.g. "Sessions: 30-day TTL", "Events: 90 days then archived to cold storage").
  Strongly affects 12-month storage projection — without TTL, growth compounds indefinitely.
- **Document size P95 / P99** — when the average row size hides outliers (large text columns,
  blob references, sparse wide rows). Call out the high-percentile size and any items
  expected to approach the 2 MB Cosmos DB item limit.
- **Hot partitions / data skew** — known skew that should influence partition key choice
  (e.g. "top 10 % of customers generate 80 % of orders", "tenant X is 100× larger than others").
- **Read mix per table** *(only when production data contradicts what the code suggests)* —
  rough split of Read TPS into point reads / single-partition queries / cross-partition queries.
  By default the schema-conversion prompt infers this from the access patterns in your source.
  Fill in here only to override (e.g. "in production 95 % of reads are point reads by orderId,
  even though the code shows many filter queries").
- **Write mix per table** *(only when production data contradicts what the code suggests)* —
  split of Write TPS into inserts / updates / deletes. Update-heavy workloads cost more RU
  because indexed properties are re-written. Default is inferred from CRUD verbs in the code.
- **Account-level intent** — multi-region read/write plans, target consistency level,
  capacity-mode preference (serverless vs provisioned/autoscale). These can shift total RU
  and storage materially (e.g. multi-region replication multiplies storage by region count;
  strong consistency roughly doubles read RU).

<!-- Free-form section: add additional context about batch jobs, seasonal spikes, integration
     points, or anything else that affects steady-state RU and storage estimates. -->
`;
}
