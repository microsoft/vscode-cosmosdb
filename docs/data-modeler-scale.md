# Data Modeler scale categories

This note documents the current implementation, not a new set of Cosmos DB sizing recommendations.
The categories are planning inputs selected by the user or prefilled by a scenario.
They are not calculated from live data or automatically classified from document counts.
Each container has its own scale profile.

## Container tab layout

Data, Queries, and Scale use a single vertical content flow without a guidance sidebar.
Related controls can still sit side by side within a section.
The container-step subtitle combines the selected template notice with tab guidance, visible across all three tabs.

- **Data:** a key/filter properties card, document shape/size, then arrays.
  The properties card groups the tag input, adjacent Upload JSON button, import feedback, and property table.
  Optional partition-key guidance expands beside the property inputs.
  The tag input excludes object/array-valued fields and fields whose paths traverse arrays.
  These fields remain in the schema table, with a warning icon and explanation in **Role** instead of a role selector.
  The icon and text use the editor theme's warning color; the explanation remains accessible without relying on color.
  JSON imports retain array ancestry, including through nested objects and mixed object/array shapes, when projects are saved.
  Default partition-key selection and derived Scale candidates use the same eligibility rules; nested scalar fields in
  ordinary objects remain eligible. If no field is eligible, the import leaves the default partition key unset.
- **Queries:** separate cards for reads with expandable query-alignment guidance, write rates, and estimated request cost.
  Each read exposes all four scenario-catalog fields: **Description**, **Peak QPS**, full SQL (**Query**),
  and filter properties (**Filters on**). Query uses a single-line input with a Fluent UI multiselect dropdown to its right.
  The dropdown lists the active container's properties. Selecting properties never rewrites SQL.
  Editing valid SQL adds explicitly referenced properties to the selection; existing selections remain so missing
  references can be flagged with a non-blocking warning. Parameters, comments, and string values do not count as references.
  Nested SQL references retain their full schema paths: `c.customer.customerId`, `c["customer"]["customerId"]`,
  and mixed dotted/bracketed forms all match `customer/customerId`. Collection aliases are excluded, and parent fields
  are only selected when separately referenced, not merely because they occur inside a nested path.
  Incomplete SQL temporarily suspends automatic selection and shows a validation hint.
  Selections are saved as property-name arrays. Older filter predicates remain readable and seed the initial selection;
  older models without SQL text open with an empty Query field. Removed properties remain visible for deselection with a warning.
- **Scale:** separate cards for candidate cardinality, items per key, write distribution, growth, and projected partition size.
  A compact Partition limits callout follows the estimate, using the Review rules callout's sparkle icon and styling,
  with a bulleted list and a visible hot-partition warning.
  Capacity warnings remain visible, not behind a disclosure.

Workload scenario cards and the three Scale option groups use native radio inputs styled as cards.
Tab enters a group at the selected option and then leaves the group; arrow keys move focus and selection,
wrapping at the ends. Space selects the focused option. Each group has its own name and a visible card focus outline.
Filtering Workload does not change the chosen scenario. If the selection is hidden, Tab enters at the first visible
option; if nothing matches, the group is not displayed. Radio names come from the visible titles, with descriptions,
badges, and hints exposed as accessible descriptions. Activating an already-selected radio does not reapply its defaults.

Selecting **Next** from Data before visiting either Queries or Scale for that container opens a native VS Code dialog.
**Configure** opens and focuses Queries; **Next** continues through the normal next-step flow.
Dismissing the dialog keeps Data selected and returns focus to Next.
Visits are tracked separately for each container during the open wizard session, including when revisiting a step,
but are not saved when the wizard is closed. Visiting either Queries or Scale suppresses the reminder for that container.

Containers created with **Add container** start with **Total attributes per document** set to 3:
an `id` key, a `type` string filter, and a `createdAt` date/time filter. The count and properties remain editable.
Workload templates and previously saved containers retain their own configuration.

**Average document size** and **Maximum document size** each have an inclusive limit of **2048 KB (2 MB)**.
An oversized edit shows an inline error and leaves the last accepted value unchanged.
The average must also be less than or equal to the maximum. Editing either field to break this rule shows an inline
error and retains its last accepted value. To raise both sizes, raise the maximum first; to lower both, lower the average first.
JSON imports reject individual documents larger than 2 MB, measured as UTF-8 serialized JSON before rounding.
Saved projects created before this limit open with any larger size estimate capped at 2048 KB.
Older projects with an average above the maximum remain openable and editable, with inline errors on the Data tab.
Recommendation requests reject inconsistent sizes in any container until they are corrected.

## Source of truth

The Result page's **Query routing → Filters on** column displays a comma-separated list of property names,
matching the Queries tab rather than showing SQL predicates. New recommendations provide property-name arrays;
older saved string predicates are converted for display using the same property extraction as the Queries tab.
The chat fallback uses the same formatting.

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
