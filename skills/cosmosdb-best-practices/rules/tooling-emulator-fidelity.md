---
title: Distinguish emulator verification from Azure runtime parity
impact: MEDIUM
impactDescription: prevents false production-readiness claims from emulator tests
tags: tooling, emulator, testing, throughput, indexing, verification
---

## Distinguish Emulator Verification from Azure Runtime Parity

Identify the emulator distribution and version, then check its current documented capabilities. For Linux vNext, consult
the [feature-support table](https://learn.microsoft.com/azure/cosmos-db/emulator-linux#feature-support) and
[documented limitations](https://learn.microsoft.com/azure/cosmos-db/emulator-linux#limitations).
Do not apply vNext limitations to every emulator or assume that a successful SDK response proves Azure-equivalent behavior.

- **Configuration is not runtime enforcement.** Linux vNext can retain throughput and index-policy metadata without
  production-equivalent RU accounting, throttling, demand-driven autoscaling, or range/composite index behavior.
  Successful queries, including sorts without the required indexes, do not validate Azure indexing requirements or performance.
- **Short bursts do not establish throttling behavior.** Azure can temporarily exceed provisioned RU/s when
  [burst capacity](https://learn.microsoft.com/azure/cosmos-db/burst-capacity) is enabled. A short above-budget run without
  HTTP 429 responses alone does not prove that enforcement is missing; account for retry behavior and observation duration.
- **Usage statistics may be placeholders or delayed.** Linux vNext has returned zero document/storage usage despite
  stored data through both SDK and direct REST reads ([upstream issue #386](https://github.com/Azure/azure-cosmos-db-emulator-docker/issues/386)).
  Record the build and observation interval rather than claiming that statistics never update. Zero counts alone do not
  prove absent data or failed seeding. Use queries when counts are needed and verify known samples by exact ID and typed
  partition-key tuple, comparing returned bodies without coercing dates or numeric values.
- **Separate client defects from emulator gaps.** Compare an affected tool operation with the equivalent supported SDK
  operation when needed. A tool-only failure calls for a verified workaround, not a weaker data model or assumed emulator limit.
- **Keep production checks separate.** Local configuration and document round trips do not certify RU budgets, rate-limit
  handling, autoscale behavior, index utilization, or security parity. Validate required production behavior on an explicitly
  authorized Azure test account; never switch targets, provision cloud resources, or expose an emulator without consent.

**Incorrect (treating local success as production assurance):**

```text
The emulator accepted the autoscale and index policies and all queries succeeded, so the RU budget and indexes are verified.
The container reports zero documents, so seeding must have failed.
```

**Correct (reporting the verified scope and remaining checks):**

```text
Configuration readback and exact sample reads match. Usage statistics are not reliable on this emulator.
Production RU enforcement, autoscaling, and index effectiveness remain unverified and require authorized Azure testing.
```

Related rules:
- [tooling-emulator-setup](tooling-emulator-setup.md) - Configure local emulator development and testing.
- [sdk-emulator-ssl](sdk-emulator-ssl.md) - Configure SDK certificates and connection mode.

Reference: [Linux vNext emulator feature support](https://learn.microsoft.com/azure/cosmos-db/emulator-linux#feature-support)