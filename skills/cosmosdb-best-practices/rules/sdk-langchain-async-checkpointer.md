---
title: Initialize Async Cosmos DB Container Before CosmosDBSaver
impact: HIGH
impactDescription: prevents credential and event-loop errors in async applications
tags: sdk, python, async, langchain, checkpointing
---

## Initialize Async Cosmos DB Container Before CosmosDBSaver

**Impact: HIGH (prevents credential and event-loop errors in async applications)**

When using `CosmosDBSaver` with the async Cosmos DB SDK, the container client must be created within an active async context (e.g., inside an `async def` function). Creating it at module level causes event-loop errors because the async credential and client require a running loop. Always initialize the async client inside your application's startup routine and recompile the LangGraph graph afterward.

**Incorrect (module-level initialization — event loop not running):**

```python
from azure.cosmos.aio import CosmosClient as AsyncCosmosClient
from azure.identity.aio import DefaultAzureCredential as AsyncDefaultAzureCredential
from langchain_azure_cosmosdb import CosmosDBSaver

# BAD: No event loop running at module import time
credential = AsyncDefaultAzureCredential()
client = AsyncCosmosClient(url, credential=credential)
container = client.get_database_client("db").get_container_client("Checkpoints")
checkpointer = CosmosDBSaver(container)  # May raise RuntimeError
```

**Incorrect (mixing sync credential with async client):**

```python
from azure.cosmos.aio import CosmosClient as AsyncCosmosClient
from azure.identity import DefaultAzureCredential  # sync credential

# BAD: Sync credential cannot be used with async CosmosClient
credential = DefaultAzureCredential()
client = AsyncCosmosClient(url, credential=credential)
```

**Correct (initialize in async startup function):**

```python
from azure.cosmos.aio import CosmosClient as AsyncCosmosClient
from azure.identity.aio import DefaultAzureCredential as AsyncDefaultAzureCredential
from langchain_azure_cosmosdb import CosmosDBSaver
from langgraph.graph import StateGraph, MessagesState

builder = StateGraph(MessagesState)
# ... add nodes and edges ...
graph = builder.compile(checkpointer=None)  # initial compile without persistence

async def setup():
    """Call during application startup (e.g., FastAPI lifespan)."""
    global graph
    credential = AsyncDefaultAzureCredential()
    client = AsyncCosmosClient(cosmos_url, credential=credential)
    database = client.get_database_client("MyDatabase")
    container = database.get_container_client("Checkpoints")
    checkpointer = CosmosDBSaver(container)
    graph = builder.compile(checkpointer=checkpointer)
```

**Tip:** Keep a reference to the `AsyncCosmosClient` so you can close it gracefully on shutdown with `await client.close()`.

Reference: [Azure Cosmos DB async Python SDK](https://learn.microsoft.com/python/api/azure-cosmos/azure.cosmos.aio?view=azure-python)
