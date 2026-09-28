---
title: Use CosmosDBSaver for LangGraph Checkpointing
impact: HIGH
impactDescription: enables persistent multi-turn conversation state across restarts
tags: sdk, python, langgraph, checkpointing, langchain
---

## Use CosmosDBSaver for LangGraph Checkpointing

**Impact: HIGH (enables persistent multi-turn conversation state across restarts)**

When building LangGraph agents that require multi-turn conversation persistence, use `CosmosDBSaver` from `langchain-azure-cosmosdb` as the checkpointer. This stores graph state in Cosmos DB, enabling conversations to survive process restarts and scale across multiple instances. The checkpointer requires an **async** container client — using a sync client will raise runtime errors.

**Incorrect (using in-memory checkpointer — state lost on restart):**

```python
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph, MessagesState

builder = StateGraph(MessagesState)
# ... add nodes and edges ...

# BAD: State is lost when the process restarts
checkpointer = MemorySaver()
graph = builder.compile(checkpointer=checkpointer)
```

**Incorrect (passing a sync container client — will fail at runtime):**

```python
from azure.cosmos import CosmosClient
from langchain_azure_cosmosdb import CosmosDBSaver

# BAD: CosmosDBSaver requires an async container client
sync_client = CosmosClient(url, credential=credential)
sync_container = sync_client.get_database_client("db").get_container_client("Checkpoints")
checkpointer = CosmosDBSaver(sync_container)  # RuntimeError
```

**Correct (async container client with CosmosDBSaver):**

```python
from azure.cosmos.aio import CosmosClient as AsyncCosmosClient
from azure.identity.aio import DefaultAzureCredential as AsyncDefaultAzureCredential
from langchain_azure_cosmosdb import CosmosDBSaver
from langgraph.graph import StateGraph, MessagesState

builder = StateGraph(MessagesState)
# ... add nodes and edges ...

# Compile initially without checkpointer (setup may be async)
graph = builder.compile(checkpointer=None)

async def initialize_checkpointer():
    credential = AsyncDefaultAzureCredential()
    client = AsyncCosmosClient(cosmos_url, credential=credential)
    database = client.get_database_client("MyDatabase")
    container = database.get_container_client("Checkpoints")
    checkpointer = CosmosDBSaver(container)
    # Recompile graph with persistent checkpointer
    return builder.compile(checkpointer=checkpointer)
```

Reference: [langchain-azure-cosmosdb documentation](https://python.langchain.com/docs/integrations/providers/azure_cosmos_db/)
