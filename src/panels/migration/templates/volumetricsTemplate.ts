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

## Additional Notes

<!-- Add any extra context about traffic patterns, seasonal spikes, batch jobs, etc. -->
`;
}
