---
title: Use LangGraph Interrupt for Human-in-the-Loop Confirmation
impact: HIGH
impactDescription: enables safe confirmation flows for sensitive operations
tags: pattern, langgraph, human-in-the-loop, interrupt, multi-agent
---

## Use LangGraph Interrupt for Human-in-the-Loop Confirmation

**Impact: HIGH (enables safe confirmation flows for sensitive operations)**

When agents perform sensitive operations (e.g., money transfers, account creation, data deletion), use LangGraph's `interrupt()` mechanism to pause execution and wait for user confirmation. The graph state is persisted to Cosmos DB via the checkpointer, and execution resumes from the same point when the user responds. This avoids custom polling loops or separate confirmation APIs.

**Incorrect (no confirmation — agent executes sensitive action immediately):**

```python
from langgraph.graph import StateGraph, MessagesState

async def call_transactions_agent(state: MessagesState, config):
    # BAD: Agent may call bank_transfer without user confirmation
    response = await transactions_agent.ainvoke(state)
    return {"messages": response["messages"]}
```

**Incorrect (manual polling loop instead of interrupt):**

```python
async def call_transactions_agent(state: MessagesState, config):
    response = await transactions_agent.ainvoke(state)
    # BAD: Custom polling — reinvents what LangGraph interrupt provides
    while not await check_user_confirmed(config):
        await asyncio.sleep(1)
    return {"messages": response["messages"]}
```

**Correct (interrupt pauses graph, state saved to Cosmos DB):**

```python
from langgraph.types import Command, interrupt
from langgraph.graph import StateGraph, MessagesState
from langchain_azure_cosmosdb import CosmosDBSaver

def human_node(state: MessagesState, config) -> None:
    """Pauses the graph and waits for the next user message."""
    interrupt(value="Ready for user input.")
    return None

async def call_transactions_agent(state: MessagesState, config) -> Command:
    response = await transactions_agent.ainvoke(state)
    # Route to human node — graph pauses, state persisted to Cosmos DB
    return Command(update=response, goto="human")

builder = StateGraph(MessagesState)
builder.add_node("transactions_agent", call_transactions_agent)
builder.add_node("human", human_node)
# ... add edges ...

graph = builder.compile(checkpointer=CosmosDBSaver(async_container))
```

**How it works:**
1. Agent node returns `Command(goto="human")` after processing
2. The `human_node` calls `interrupt()`, which persists state and pauses
3. The caller receives a response indicating the graph is waiting
4. When the user sends a new message, the caller resumes the graph with `graph.stream(new_input, config)`
5. The checkpointer restores state from Cosmos DB and continues from where it paused

Reference: [LangGraph human-in-the-loop](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/)
