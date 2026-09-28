---
title: Filter MCP Tools by Name Prefix for Agent Assignment
impact: MEDIUM
impactDescription: reduces agent confusion and improves routing accuracy
tags: sdk, python, mcp, langchain, multi-agent
---

## Filter MCP Tools by Name Prefix for Agent Assignment

**Impact: MEDIUM (reduces agent confusion and improves routing accuracy)**

When a single MCP server exposes tools for multiple domains, assign each LangGraph agent only the subset of tools it needs. Use a name-prefix convention on the server side (e.g., `get_transaction_history`, `get_offer_information`, `transfer_to_sales_agent`) and filter client-side by prefix. This prevents agents from calling tools outside their domain and reduces prompt confusion from irrelevant tool descriptions.

**Incorrect (all agents receive all tools):**

```python
from langchain_mcp_adapters.tools import load_mcp_tools
from langgraph.prebuilt import create_react_agent

all_tools = await load_mcp_tools(session)

# BAD: Every agent sees every tool — leads to wrong tool calls
support_agent = create_react_agent(model, all_tools, prompt=support_prompt)
sales_agent = create_react_agent(model, all_tools, prompt=sales_prompt)
transactions_agent = create_react_agent(model, all_tools, prompt=transactions_prompt)
```

**Correct (filter tools by prefix per agent):**

```python
from langchain_mcp_adapters.tools import load_mcp_tools
from langgraph.prebuilt import create_react_agent

all_tools = await load_mcp_tools(session)

def filter_tools_by_prefix(tools, prefixes):
    """Return only tools whose name starts with one of the given prefixes."""
    return [t for t in tools if any(t.name.startswith(p) for p in prefixes)]

# Each agent gets only the tools relevant to its domain
support_tools = filter_tools_by_prefix(all_tools, [
    "service_request", "get_branch_location", "transfer_to_"
])
sales_tools = filter_tools_by_prefix(all_tools, [
    "get_offer_information", "create_account", "calculate_monthly_payment", "transfer_to_"
])
transactions_tools = filter_tools_by_prefix(all_tools, [
    "bank_transfer", "get_transaction_history", "bank_balance", "transfer_to_"
])

support_agent = create_react_agent(model, support_tools, prompt=support_prompt)
sales_agent = create_react_agent(model, sales_tools, prompt=sales_prompt)
transactions_agent = create_react_agent(model, transactions_tools, prompt=transactions_prompt)
```

**Naming convention tip:** Include `transfer_to_` prefixed tools in each agent's set so agents can hand off conversations to other agents via the routing mechanism.

Reference: [LangGraph prebuilt agents](https://langchain-ai.github.io/langgraph/reference/prebuilt/)
