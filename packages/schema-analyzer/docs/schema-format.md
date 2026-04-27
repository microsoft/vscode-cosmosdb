# Schema Output Format

This document describes the JSON Schema output produced by `@cosmosdb/schema-analyzer`, including all vendor `x-*` extensions.

## Overview

The output conforms to [JSON Schema draft-07](https://json-schema.org/draft-07/json-schema-release-notes.html) with additional `x-*` vendor properties for statistical metadata. This means the schema is valid JSON Schema and can be consumed by standard tooling (editors, validators) while also carrying rich analysis data.

## Root Schema Node

```jsonc
{
  "x-documentsInspected": 100, // total documents analyzed
  "properties": {
    "fieldName": {
      /* property schema */
    },
  },
}
```

## Property Schema Node

Each property has an `anyOf` array with one entry per observed type:

```jsonc
{
  "anyOf": [
    {
      /* type entry 1 */
    },
    {
      /* type entry 2 */
    },
  ],
  "x-occurrence": 95, // how many documents had this property
}
```

After `simplifySchema()`, single-type properties are unwrapped:

```jsonc
{
  "type": "string",
  "x-dataType": "string", // or "x-bsonType" for BSON
  "x-typeOccurrence": 95,
  "x-occurrence": 95,
  "x-minLength": 3,
  "x-maxLength": 128,
}
```

## Type Entry Schema

Each entry in `anyOf` describes one observed type:

```jsonc
{
  "type": "string", // JSON Schema type
  "x-dataType": "string", // JSON analyzer: original type
  // — OR —
  "x-bsonType": "objectid", // BSON analyzer: original BSON type
  "x-typeOccurrence": 95, // how many times this type was observed
}
```

## Statistics Extensions by Type

### Strings (`type: "string"`)

```jsonc
{
  "x-minLength": 3,
  "x-maxLength": 128,
}
```

### Numbers (`type: "number"`)

```jsonc
{
  "x-minValue": 0,
  "x-maxValue": 99999,
}
```

### Booleans (`type: "boolean"`)

```jsonc
{
  "x-trueCount": 72,
  "x-falseCount": 28,
}
```

### Objects (`type: "object"`)

```jsonc
{
  "x-minProperties": 2,
  "x-maxProperties": 8,
  "x-documentsInspected": 95, // BSON only (when trackNestedObjectDocs is enabled)
  "properties": {
    "childField": {
      /* ... */
    },
  },
}
```

### Arrays (`type: "array"`)

```jsonc
{
  "x-minItems": 0,
  "x-maxItems": 50,
  "items": {
    "anyOf": [{ "type": "string", "x-dataType": "string", "x-typeOccurrence": 120 }],
  },
}
```

### Dates (`type: "string"`, `x-bsonType: "date"`) — BSON only

```jsonc
{
  "x-minDate": 1609459200000, // epoch ms
  "x-maxDate": 1704067200000,
}
```

### Binary (`type: "string"`, `x-bsonType: "binary"`) �� BSON only

```jsonc
{
  "x-minLength": 16,
  "x-maxLength": 1024,
}
```

## Full Example

Input documents:

```json
[
  { "name": "Alice", "age": 30, "tags": ["admin"] },
  { "name": "Bob", "age": 25, "active": true }
]
```

Output schema (after `simplifySchema()`):

```jsonc
{
  "x-documentsInspected": 2,
  "properties": {
    "name": {
      "type": "string",
      "x-dataType": "string",
      "x-typeOccurrence": 2,
      "x-occurrence": 2,
      "x-minLength": 3,
      "x-maxLength": 5,
    },
    "age": {
      "type": "number",
      "x-dataType": "number",
      "x-typeOccurrence": 2,
      "x-occurrence": 2,
      "x-minValue": 25,
      "x-maxValue": 30,
    },
    "tags": {
      "type": "array",
      "x-dataType": "array",
      "x-typeOccurrence": 1,
      "x-occurrence": 1,
      "x-minItems": 1,
      "x-maxItems": 1,
      "items": {
        "anyOf": [
          {
            "type": "string",
            "x-dataType": "string",
            "x-typeOccurrence": 1,
            "x-minLength": 5,
            "x-maxLength": 5,
          },
        ],
      },
    },
    "active": {
      "type": "boolean",
      "x-dataType": "boolean",
      "x-typeOccurrence": 1,
      "x-occurrence": 1,
      "x-trueCount": 1,
      "x-falseCount": 0,
    },
  },
}
```

## Probability Calculation

Field probability (how likely a field is to be present in a document):

```
probability = property["x-occurrence"] / parentSchema["x-documentsInspected"]
```

Type probability (how likely a specific type is for a given field):

```
typeProbability = typeEntry["x-typeOccurrence"] / property["x-occurrence"]
```

For nested objects in BSON mode, use the nested `x-documentsInspected` counter on the object type entry as the denominator.
