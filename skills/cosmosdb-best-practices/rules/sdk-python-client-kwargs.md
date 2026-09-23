---
title: Configure the Python Client with Keyword Arguments, Not ConnectionPolicy
impact: MEDIUM
impactDescription: avoids deprecated config surface, future-proofs the client
tags: sdk, python, configuration, client
---

## Configure the Python Client with Keyword Arguments, Not ConnectionPolicy

In the Python `azure-cosmos` v4 SDK, all `CosmosClient` configuration is passed as
keyword arguments directly to the constructor — timeouts, retries, preferred
regions, TLS verification, diagnostics, and more. Internally the client maps those
kwargs onto a `ConnectionPolicy` for you, so you never construct that object yourself.

Hand-building an `azure.cosmos.documents.ConnectionPolicy` and mutating its
attributes (`RequestTimeout`, `PreferredLocations`, `DisableSSLVerification`, ...)
before passing it via `connection_policy=` is a legacy pattern carried over from the
old `pydocumentdb` / v3 SDK. It still works for backward compatibility, but it is
undocumented as the v4 surface, easy to get wrong (for example `RequestTimeout` is in
different units than the `connection_timeout` kwarg), and steers toward config knobs
that are already deprecated. The related object/kwarg forms `retry_options=` and
`connection_retry_policy=` emit `DeprecationWarning` at runtime and will be removed.
Use the flat kwargs instead — they are the supported, documented API.

**Incorrect (build a ConnectionPolicy object and mutate its attributes):**

```python
from azure.cosmos import CosmosClient
from azure.cosmos import documents

# Legacy v3 / pydocumentdb carry-over: agents commonly reach for this because
# ConnectionPolicy has named, discoverable attributes.
policy = documents.ConnectionPolicy()
policy.RequestTimeout = 10000            # units differ from the connection_timeout kwarg
policy.PreferredLocations = ["West US 2", "East US 2"]
policy.DisableSSLVerification = True

client = CosmosClient(
    url,
    credential=key,
    connection_policy=policy,            # backward-compat escape hatch, not the v4 API
)
```

**Correct (pass configuration as keyword arguments to CosmosClient):**

```python
from azure.cosmos import CosmosClient

# The documented v4 surface. The SDK maps these kwargs onto its internal
# ConnectionPolicy for you.
client = CosmosClient(
    url,
    credential=key,
    connection_timeout=10,               # seconds (NOT the ms-based legacy request_timeout)
    preferred_locations=["West US 2", "East US 2"],
    retry_total=9,                       # azure-core throttle/retry, replaces RetryOptions
    connection_verify=True,              # keep TLS verification on in production
    enable_diagnostics_logging=True,
)
```

Only set `connection_verify=False` for the local emulator's self-signed
certificate — never against a real account. See the `sdk-emulator-ssl` rule for the
full emulator configuration.

Best practices:
- Prefer `connection_timeout=<seconds>` over the legacy `request_timeout=<ms>` kwarg.
- Do not construct `documents.ConnectionPolicy` in application code; pass kwargs.
- Avoid the deprecated `retry_options=` and `connection_retry_policy=` kwargs; use
  the flat `retry_total`, `retry_backoff_max`, and related retry kwargs.
- `SSLConfiguration` / `ProxyConfiguration` objects are still required for those
  specific settings — this rule targets `ConnectionPolicy`, not those helpers.

Reference: [azure.cosmos.CosmosClient](https://learn.microsoft.com/python/api/azure-cosmos/azure.cosmos.cosmosclient?view=azure-python)
