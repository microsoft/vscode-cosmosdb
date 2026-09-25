# Data Modeler scale categories

This note documents the current implementation, not a new set of Cosmos DB sizing recommendations.
The categories are planning inputs selected by the user or prefilled by a scenario.
They are not calculated from live data or automatically classified from document counts.
Each container has its own scale profile.

## Source of truth

- [ScalePage.tsx](../src/webviews/cosmosdb/DataModeling/pages/ScalePage.tsx):
  `ITEMS_OPTIONS`, `GROWTH_OPTIONS`, `ITEMS_MULTIPLIER`, and the storage estimate.
- [models.ts](../src/webviews/cosmosdb/DataModeling/models.ts):
  `ItemsPerPartition`, `DataGrowth`, and `ScaleProfile`.
- [ReviewPage.tsx](../src/webviews/cosmosdb/DataModeling/pages/ReviewPage.tsx):
  maps the selected categories to readable labels in each container summary.

## Items per partition-key value

This means documents sharing one partition-key value, not all documents in the container.
It is also different from cardinality, which counts distinct partition-key values.

| Stored value | Review label | Range displayed on the Scale page | Representative count for storage estimate |
| ------------ | ------------ | --------------------------------- | ----------------------------------------- |
| `low`        | Low          | < 1,000 items                     | 500                                       |
| `medium`     | Medium       | 1K - 100K items                   | 50,000                                    |
| `high`       | High         | 100K - 1M items                   | 500,000                                   |
| `very-high`  | Very high    | > 1M items                        | 2,000,000                                 |

The range labels overlap at 100,000. There is no numeric classifier resolving this boundary:
selecting a card directly stores its category in `container.scale.items`.
The representative counts are illustrative values, not measured counts or upper bounds.

## Growth per partition-key value

| Stored value | Review label | Guidance displayed on the Scale page    |
| ------------ | ------------ | --------------------------------------- |
| `bounded`    | Bounded      | Size stabilizes over time               |
| `slow`       | Slow         | Approximately 500 items/year per entity |
| `rapid`      | Rapid        | 1,000+ items/day                        |

These are qualitative selections stored in `container.scale.growth`, not a complete set of
growth-rate thresholds. The UI does not define how to classify intermediate rates.
The input group is labeled "Data growth per PK value"; the slow-growth description uses
"per entity" wording.

Growth is shown in the Review summary but is **not used in the local storage-estimate formula**.
There is no time horizon or extrapolation of annual/daily growth in that estimate.

## Illustrative storage estimate

The current calculation in `ScalePage.tsx` is:

```ts
const ITEMS_MULTIPLIER: Record<ItemsPerPartition, number> = {
    low: 500,
    medium: 50000,
    high: 500000,
    'very-high': 2000000,
};

const itemsCount = ITEMS_MULTIPLIER[scale.items];
const projectedGb = (avgDocSizeKb * itemsCount) / (1024 * 1024);
const overLimit = projectedGb > 20;
```

`avgDocSizeKb` is the active container's supplied average document size.
The UI displays the result to two decimal places and warns only when the unrounded value
is strictly greater than 20. For example, 1 KB and `medium` yield approximately 0.05 GB
using 50,000 items.

The UI labels the units KB and GB while the calculation uses powers of 1024.
This is an approximate planning display, not a compliance guarantee or a measurement of actual storage.

## Existing warning copy

The very-high item and rapid-growth cards contain wording about hierarchical partition keys (HPK)
or bucketing. That wording is guidance displayed by the Scale page, not a guarantee of the
recommendation engine's output. The current
[recommendation skill](../skills/cosmosdb-data-model-recommendation/SKILL.md) limits recommendations
to single-path keys.
