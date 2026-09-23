---
title: Handle MCP ToolMessage Content Format Variations
impact: HIGH
impactDescription: prevents JSON parse failures from langchain-mcp-adapters >= 0.2.0
tags: sdk, python, mcp, langchain, tools
---

## Handle MCP ToolMessage Content Format Variations

**Impact: HIGH (prevents JSON parse failures from langchain-mcp-adapters >= 0.2.0)**

Starting with `langchain-mcp-adapters` 0.2.0, `ToolMessage.content` changed from a plain JSON string to a list of content blocks (e.g., `[{"type": "text", "text": "..."}]`). Any code that parses `ToolMessage.content` must handle both formats to remain compatible across versions and avoid `json.JSONDecodeError` or `TypeError`.

**Incorrect (assumes content is always a string):**

```python
import json
from langchain_core.messages import ToolMessage

def extract_routing_info(message: ToolMessage):
    # BAD: Fails when content is a list (langchain-mcp-adapters >= 0.2.0)
    data = json.loads(message.content)
    return data.get("goto")
```

Error with newer adapter versions:
```
TypeError: the JSON object must be str, bytes or bytearray, not list
```

**Correct (handles both string and list formats):**

```python
import json
from langchain_core.messages import ToolMessage

def extract_routing_info(message: ToolMessage):
    content = message.content

    # Handle list-of-blocks format (langchain-mcp-adapters >= 0.2.0)
    if isinstance(content, list):
        text_parts = [block["text"] for block in content if block.get("type") == "text"]
        content = text_parts[0] if text_parts else ""

    # Now content is a plain string — safe to parse
    data = json.loads(content)
    return data.get("goto")
```

**When this matters:** Any time you inspect tool call results programmatically — for example, to extract routing decisions, parse structured responses, or implement conditional logic based on tool outputs.

Reference: [langchain-mcp-adapters changelog](https://github.com/langchain-ai/langchain-mcp-adapters)
