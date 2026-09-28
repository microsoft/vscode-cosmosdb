---
title: Use StateGraph with Conditional Edges for Multi-Agent Routing
impact: HIGH
impactDescription: enables deterministic agent hand-off in multi-agent LangGraph applications
tags: pattern, langgraph, multi-agent, routing, cosmos-db
---

## Use StateGraph with Conditional Edges for Multi-Agent Routing

**Impact: HIGH (enables deterministic agent hand-off in multi-agent LangGraph applications)**

When building multi-agent systems with LangGraph backed by Cosmos DB checkpointing, use `StateGraph` with `add_conditional_edges` to route between agents based on tool call results or persisted state. Each agent node should return a `Command` that updates state and directs the graph to the next node (e.g., a human-input node). A conditional edge function inspects the state (or Cosmos DB) to determine which agent handles the next turn.

**Incorrect (linear chain — no dynamic routing between agents):**

```python
from langgraph.graph import StateGraph, START, MessagesState

builder = StateGraph(MessagesState)
builder.add_node("agent_a", call_agent_a)
builder.add_node("agent_b", call_agent_b)

# BAD: Fixed linear flow — cannot route dynamically
builder.add_edge(START, "agent_a")
builder.add_edge("agent_a", "agent_b")
builder.add_edge("agent_b", END)
```

**Correct (conditional edges with dynamic routing):**

```python
from typing import Literal
from langgraph.graph import StateGraph, START, MessagesState
from langgraph.types import Command
from langchain_azure_cosmosdb import CosmosDBSaver

async def call_agent_a(state: MessagesState, config) -> Command[Literal["agent_a", "human"]]:
    response = await agent_a.ainvoke(state)
    return Command(update=response, goto="human")

async def call_agent_b(state: MessagesState, config) -> Command[Literal["agent_b", "human"]]:
    response = await agent_b.ainvoke(state)
    return Command(update=response, goto="human")

def route_to_agent(state: MessagesState, config) -> str:
    """Determine which agent handles the next message based on state or DB lookup."""
    # Inspect tool messages for routing hints, or query Cosmos DB for active agent
    # Return the node name to route to
    return "agent_a"  # or "agent_b" based on logic

builder = StateGraph(MessagesState)
builder.add_node("coordinator", call_coordinator)
builder.add_node("agent_a", call_agent_a)
builder.add_node("agent_b", call_agent_b)
builder.add_node("human", human_node)

builder.add_edge(START, "coordinator")
builder.add_conditional_edges(
    "coordinator",
    route_to_agent,
    {"agent_a": "agent_a", "agent_b": "agent_b", "coordinator": "coordinator"}
)

graph = builder.compile(checkpointer=CosmosDBSaver(async_container))
```

**Critical: Only check NEW messages for routing decisions.** When a sub-agent is invoked with `await agent.ainvoke(state)`, the response contains ALL messages — both the existing conversation history AND new messages. If node functions iterate all messages to find routing ToolMessages, they will find old routing messages from previous turns and re-route infinitely, causing a `GraphRecursionError`.

```python
async def call_agent_a(state: MessagesState, config) -> Command[Literal["agent_a", "agent_b", "human"]]:
    response = await agent_a.ainvoke(state)

    # CRITICAL: Only check NEW messages added by this invocation
    existing_count = len(state.get("messages", []))
    new_messages = response.get("messages", [])[existing_count:]

    for msg in reversed(new_messages):
        if isinstance(msg, ToolMessage):
            goto = extract_routing_info(msg)
            if goto:
                return Command(update=response, goto=goto)

    return Command(update=response, goto="human")
```

**Key principles:**
1. Each agent node returns `Command(update=response, goto="human")` to yield control back for user input
2. After user input, the coordinator's conditional edge function decides which agent continues
3. Use Cosmos DB point reads in the routing function for O(1) active-agent lookups
4. Include a fallback route to the coordinator when the active agent is unknown
5. Always slice `response["messages"]` by `len(state["messages"])` to get only new messages — never iterate the full history for routing decisions

Reference: [LangGraph multi-agent patterns](https://langchain-ai.github.io/langgraph/concepts/multi_agent/)
