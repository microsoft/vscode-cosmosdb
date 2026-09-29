---
description: Infer JSON and BSON document shapes and use observed fields in an editor.
---

# Schema analyzer

`@azure/cosmosdb-schema-analyzer` summarizes the documents you supply. It does not fetch documents, validate a collection, or discover fields absent from your sample.

## Entry points

| Import                                 | Purpose                                        | Runtime requirement                                       |
| -------------------------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `@azure/cosmosdb-schema-analyzer`      | Shared `JSONSchema` type and schema utilities  | No MongoDB driver required                                |
| `@azure/cosmosdb-schema-analyzer/json` | Plain JSON document inference                  | Suitable for browser examples                             |
| `@azure/cosmosdb-schema-analyzer/bson` | BSON-aware `SchemaAnalyzer` and type utilities | Optional peer `mongodb >=6.0.0`, required when using BSON |

## Infer a JSON schema

```ts
import { getKnownFields } from "@azure/cosmosdb-schema-analyzer";
import { getSchemaFromDocuments } from "@azure/cosmosdb-schema-analyzer/json";

const schema = getSchemaFromDocuments([
  { name: "Notebook", price: 8, tags: ["paper"] },
  { name: "Pencil", price: "2", inStock: true }
]);

console.log(schema["x-documentsInspected"]); // 2
console.log(getKnownFields(schema, "x-dataType"));
```

`price` has two observed types; `tags` and `inStock` are missing from one document. These are observations, not errors.

### JSON API and defaults

| Function                                     | Input                                  | Behavior                                                                                        |
| -------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `getSchemaFromDocument(document)`            | `Record<string, unknown>`              | Returns a new schema with unsimplified type entries.                                            |
| `getSchemaFromDocuments(documents)`          | Array of document objects              | Merges all supplied documents, simplifies the result, and returns it. Throws on an empty array. |
| `updateSchemaWithDocument(schema, document)` | Existing `JSONSchema` and one document | Mutates the schema; returns `void`.                                                             |
| `simplifySchema(schema)`                     | `JSONSchema`                           | Normalizes type wrappers in place; returns `void`. Not byte-budget reduction; see below.        |
| `getKnownFields(schema, typeExtensionKey)`   | Schema and required type-key string    | Returns field paths and dominant observed types. Use `'x-dataType'` for JSON.                   |

There is no automatic sampling limit or database pagination. Every supplied document is analyzed; choose a representative, bounded sample in the host application. Validate browser input as a non-empty array of document objects before calling the batch API.

### Structural normalization: `simplifySchema`

The published package's `simplifySchema(schema): void` and the extension's size-reduction workflow are different
operations. **The npm function does not return a new schema or accept a target size.**

Starting from the root's `properties`, it visits field schemas recursively, including nested `properties`,
`anyOf` alternatives, and array `items`. Where `anyOf` has exactly one entry, it copies that entry's members onto
the containing node and removes the wrapper. Multiple alternatives remain intact. It does not rank or discard
fields, limit nesting depth, or strip statistics.

For example, a field node with one observed type changes from:

```json
{
  "x-occurrence": 2,
  "anyOf": [{ "type": "string", "x-typeOccurrence": 2, "x-dataType": "string" }]
}
```

to:

```json
{
  "x-occurrence": 2,
  "type": "string",
  "x-typeOccurrence": 2,
  "x-dataType": "string"
}
```

This removes redundant nesting, but is not intended to turn a tens-of-megabytes schema into a small editor or AI
context. `getSchemaFromDocuments` applies this normalization automatically before returning its newly built schema.

For incremental collection, keep an unsimplified accumulator and explicitly create a separate copy for normalization:

```ts
import type { JSONSchema } from "@azure/cosmosdb-schema-analyzer";
import {
  simplifySchema,
  updateSchemaWithDocument
} from "@azure/cosmosdb-schema-analyzer/json";

const accumulated: JSONSchema = {};
updateSchemaWithDocument(accumulated, { name: "Notebook", price: 8 });
updateSchemaWithDocument(accumulated, { name: "Pencil", price: 2 });

const displaySchema = structuredClone(accumulated);
simplifySchema(displaySchema);
```

### Read the output

The output uses JSON Schema structure with statistical `x-*` extensions:

| Property                             | Meaning                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `properties`, `items`, `anyOf`       | Object fields, array elements, and alternative observed types                                                                                    |
| `x-documentsInspected`               | Number of analyzed documents at the tracked level                                                                                                |
| `x-occurrence`                       | Number of times this property was present at its location in the schema hierarchy, across all observed types.                                    |
| `x-typeOccurrence`                   | Number of times a particular type was observed for this property or array item at that location.                                                 |
| `x-dataType` / `x-bsonType`          | Original JSON / BSON type tag                                                                                                                    |
| `x-minValue`, `x-maxValue`           | Observed numeric bounds, not enforced limits                                                                                                     |
| `x-minLength`, `x-maxLength`         | Observed minimum/maximum string length (`String.length`, UTF-16 code units); the BSON analyzer also uses these for binary buffer sizes in bytes. |
| `x-minItems`, `x-maxItems`           | Observed minimum/maximum number of elements in an array.                                                                                         |
| `x-minProperties`, `x-maxProperties` | Observed minimum/maximum number of properties in an object.                                                                                      |

Do not treat observed frequency as a `required` constraint. JSON inference does not track nested-object document counts in the same way as BSON, so nested sparsity is not a complete probability model.

### Frequency and suggestion ranking

These are **occurrence counts**, not percentages. They describe how frequently a property or type appeared in the
sample, so consumers can prioritize common fields and the most likely types.

`x-occurrence` belongs to a particular property within its parent schema. For example, `name`, `address.name`, and
`orders[].name` have separate counters even though the property name is the same. A missing property does not
increment its counter. Within an array of objects, each element containing the property contributes an observation,
so the count can exceed the number of root documents.

If `value` occurs in 11 documents, as a string in 10 and a number in one, its schema contains these counts
(other statistics omitted):

```json
{
  "properties": {
    "value": {
      "x-occurrence": 11,
      "anyOf": [
        { "type": "string", "x-dataType": "string", "x-typeOccurrence": 10 },
        { "type": "number", "x-dataType": "number", "x-typeOccurrence": 1 }
      ]
    }
  }
}
```

A frequency-ranked type suggestion should prefer `string` over `number` in this example, without discarding the
less common numeric alternative. `getKnownFields(schema, 'x-dataType')` uses `x-typeOccurrence` to select the
dominant type, so it reports `string` for this field.

Distinguish that type preference from field ordering: the language service uses `x-occurrence` to prioritize field
completions at the current hierarchy level. In version 1.0.0, its field-completion adapter does **not** yet rank
the `anyOf` type alternatives by `x-typeOccurrence`; a mixed-type field can display `unknown` as its completion
detail. The counters support type-aware ranking, but do not by themselves guarantee that every editor integration
implements it.

## Reducing large schemas to a size budget

A different goal is to turn a large, detailed schema into a smaller working representation that is cheaper to load,
traverse, and use for query assistance. For example, **50 MiB down toward a 5 MiB target** is a size-reduction goal,
not merely removal of `anyOf` wrappers.

The VS Code extension implements this in
[`aggressivelySimplify`](https://github.com/microsoft/vscode-cosmosdb/blob/main/src/services/SchemaService.ts).
**This function is not exported by `@azure/cosmosdb-schema-analyzer` 1.0.0.** The following describes the extension's
workflow, not extra options available on the npm package's `simplifySchema`.

### How the reduction works

1. **Create an independent copy.** Deep-clone the input with `structuredClone`. All subsequent changes apply to the
   clone; the caller's original schema is untouched. The result contains `schema`, `wasSimplified`, and `popularityKeyHit`.
2. **Remove detailed statistics.** Recursively remove document counts, min/max object-property counts, array lengths,
   string lengths, numeric values, dates, and boolean counts. Keep `x-occurrence`, `x-typeOccurrence`, and the
   `x-dataType` / `x-bsonType` tags used for ranking and type information. Stop if this already meets the byte budget.
3. **Trim nested fields by frequency, deepest first.** If popularity counters exist, visit successive depths from the
   deepest level toward the root. At each visited object, retain at most `keepTopN` children ranked by `popularityKey`;
   a missing counter ranks as zero. Re-measure after each depth and stop as soon as the result fits.
4. **Adapt the root field count to the remaining budget.** Rank root properties by frequency, then binary-search for
   the largest number that fits. `rootKeepTopN` is a minimum to retain when that many fields exist, not a maximum.
   If even that minimum exceeds the budget, keep it rather than deleting still more top-level fields.
5. **Limit depth if still oversized.** If the earlier steps do not meet the budget, replace non-empty `properties`
   maps at or beyond `maxDepth` with empty maps, preserving the surrounding structural nodes. Without popularity
   counters, the frequency-based steps are skipped and this is the fallback after statistics removal.

The root has depth zero. Moving into a property or an array's `items` increases depth; entering an `anyOf` branch
does not. The depth cap is a fallback, not a transformation applied to every schema regardless of size.

### Parameters and current extension defaults

| Parameter         | Meaning                                                                                                                     | Default                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `targetSizeBytes` | Target for compact JSON encoded as UTF-8, not gzip size or JavaScript heap usage.                                           | `50 * 1024` bytes (50 KiB) for `getSimplifiedSchema`; `5 * 1024 * 1024` bytes (5 MiB) for the save-time guard. |
| `keepTopN`        | Maximum children kept per nested object during a frequency-trimming pass.                                                   | `2`                                                                                                            |
| `rootKeepTopN`    | Minimum root properties retained during adaptive root trimming, if available. Additional fields are retained when they fit. | `50`                                                                                                           |
| `maxDepth`        | Fallback depth at which nested property maps are emptied.                                                                   | `3`                                                                                                            |
| `popularityKey`   | Field-occurrence counter used to rank properties.                                                                           | `'x-occurrence'`                                                                                               |

`SchemaService.getSimplifiedSchema` supplies defaults and reports `originalSizeBytes` and `simplifiedSizeBytes`.
The lower-level `aggressivelySimplify` helper requires all options explicitly. The save-time guard runs only when
the generated or merged schema exceeds 5 MiB; the AI-facing path uses the smaller 50 KiB target.

### Trade-offs and size guarantees

This is **lossy structural reduction**, not lossless compression. Rare fields, detailed statistics, and deep
descendants can disappear. If a reduced schema supplies editor completions, omitted fields cannot be suggested
from that schema; their absence does not make them invalid in the actual documents. Keep the full schema separately
when complete coverage or continued statistical accumulation matters.

There is no fixed reduction ratio, and `targetSizeBytes` is a goal rather than a guaranteed upper bound. Root-field
preservation and the remaining schema content can leave the result above budget. The extension checks the resulting
size and warns if it must save a still-oversized schema. Treat "50 MiB to 5 MiB" as an example target, not a measured
result promised for every input.

## Executable JSON sample

The same schema workflow supplies fields to the browser language service:

<<< ./samples/schema.ts#example

## BSON in Node.js

Install the driver in the application that uses the BSON entry point:

```sh
npm install @azure/cosmosdb-schema-analyzer@1.0.0 mongodb@^6
```

```ts
import { ObjectId } from "mongodb";
import { SchemaAnalyzer } from "@azure/cosmosdb-schema-analyzer/bson";

const analyzer = new SchemaAnalyzer();
analyzer.addDocument({
  _id: new ObjectId(),
  name: "Notebook",
  created: new Date("2025-01-01")
});
console.log(analyzer.getDocumentCount()); // 1
console.log(analyzer.getKnownFields());
```

| Member                    | Contract                                                      |
| ------------------------- | ------------------------------------------------------------- |
| `addDocument(document)`   | Adds a `WithId<Document>` and increments `version`.           |
| `addDocuments(documents)` | Adds a readonly array; increments `version` once per call.    |
| `getSchema()`             | Returns the live cumulative schema, not a detached copy.      |
| `getKnownFields()`        | Returns a cached field list, refreshed after version changes. |
| `getDocumentCount()`      | Starts at `0`; counts analyzed documents.                     |
| `reset()`                 | Clears state and increments `version`.                        |
| `clone()`                 | Copies schema state into an independent analyzer.             |

Avoid mutating the live schema or cached field list; doing so bypasses version tracking. Use a clone when you need independently mutable state.

**Do not bundle BSON or the MongoDB driver into this site's browser playground.** The browser path uses plain JSON only; JSON text cannot preserve driver-specific BSON values.

See the [schema-format reference](https://github.com/microsoft/vscode-cosmosdb/blob/main/packages/schema-analyzer/docs/schema-format.md) and [type-system documentation](https://github.com/microsoft/vscode-cosmosdb/blob/main/packages/schema-analyzer/docs/type-systems.md) for deeper source-level details.
