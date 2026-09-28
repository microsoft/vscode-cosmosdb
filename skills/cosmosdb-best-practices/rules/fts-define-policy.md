---
title: Define Full-Text Policy on the Container
impact: HIGH
impactDescription: required for tokenizer and stop-word configuration
tags:
  - fts
  - full-text-search
  - policy
  - container
  - bicep
  - java
  - language
---

## Define Full-Text Policy on the Container

**Impact: HIGH (required for tokenizer and stop-word configuration)**

The `fullTextPolicy` declares which paths are full-text searchable and their language. Supported languages: `en-US`, `de-DE` (preview), `fr-FR` (preview), `it-IT` (preview), `pt-BR` (preview), `pt-PT` (preview), `es-ES` (preview). Language codes are **case-sensitive** — use the exact casing shown (e.g., `en-US` not `en-us`).

**Incorrect (wrong language casing causes ARM BadRequest):**

```bicep
fullTextPolicy: {
  defaultLanguage: 'en-us'       // ❌ lowercase — rejected by ARM
  fullTextPaths: [
    { path: '/description', language: 'en-us' }  // ❌
  ]
}
```

**Correct (Bicep):**

```bicep
#disable-next-line BCP037
fullTextPolicy: {
  defaultLanguage: 'en-US'       // ✅ exact casing required
  fullTextPaths: [
    {
      path: '/description'
      language: 'en-US'          // ✅
    }
  ]
}
```

**Correct — Java SDK (container creation):**

```java
FullTextPolicy ftsPolicy = new FullTextPolicy()
    .setDefaultLanguage("en-US")
    .setFullTextPaths(List.of(
        new FullTextPath().setPath("/description").setLanguage("en-US")
    ));

CosmosContainerProperties props = new CosmosContainerProperties("videos", "/videoid");
props.setFullTextPolicy(ftsPolicy);
database.createContainerIfNotExists(props).block();
```

Reference: [Configure full-text policy](https://learn.microsoft.com/azure/cosmos-db/gen-ai/full-text-search)
