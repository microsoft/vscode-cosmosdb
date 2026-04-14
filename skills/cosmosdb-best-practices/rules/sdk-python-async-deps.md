---
title: Include aiohttp When Using Python Async SDK
impact: HIGH
impactDescription: prevents application startup failure
tags: sdk, python, async, dependencies
---

## Include aiohttp When Using Python Async SDK

When using the Azure Cosmos DB Python SDK's async client (`azure.cosmos.aio`), you **must** explicitly install `aiohttp` as a dependency. The `azure-cosmos` package does not automatically install `aiohttp` — it is an optional dependency required only for async operations.

**Incorrect (missing aiohttp — application will crash on startup):**

```txt
# requirements.txt
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
azure-cosmos>=4.6.0
```

```python
# main.py — this import will fail at runtime without aiohttp
from azure.cosmos.aio import CosmosClient
```

Error: `ModuleNotFoundError: No module named 'aiohttp'`

**Correct (aiohttp explicitly listed):**

```txt
# requirements.txt
fastapi>=0.110.0
uvicorn[standard]>=0.27.0
azure-cosmos>=4.6.0
aiohttp>=3.9.0
```

```python
# main.py — works correctly with aiohttp installed
from azure.cosmos.aio import CosmosClient
```

**Alternative — use the sync client if async is not needed:**

```python
# No aiohttp required for synchronous usage
from azure.cosmos import CosmosClient
```

Reference: [Azure Cosmos DB Python SDK](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/sdk-python)
