---
title: Use AzureCosmosDBNoSQLChatMessageHistory for Persistent Conversations in JS/TS
impact: HIGH
impactDescription: enables persistent multi-turn conversations that survive restarts and scale horizontally
tags: sdk, javascript, typescript, langchain, chat-history, persistence
---

## Use AzureCosmosDBNoSQLChatMessageHistory for Persistent Conversations in JS/TS

**Impact: HIGH (enables persistent multi-turn conversations that survive restarts and scale horizontally)**

When building conversational AI applications with LangChain.js, use `AzureCosmosDBNoSQLChatMessageHistory` to persist chat messages in Cosmos DB. This ensures conversations survive process restarts, enables horizontal scaling across multiple instances, and provides a queryable audit trail. Each conversation session is stored as a document identified by a `sessionId`, with the partition key enabling efficient retrieval.

**Incorrect (in-memory history — lost on restart, no horizontal scaling):**

```typescript
import { ChatMessageHistory } from "langchain/memory";

// BAD: Messages lost when process restarts or user hits different instance
const history = new ChatMessageHistory();
await history.addUserMessage("Hello");
await history.addAIMessage("Hi there!");
// Process restarts... conversation is gone
```

**Incorrect (wrong partition key — cross-partition queries for session lookup):**

```typescript
import { AzureCosmosDBNoSQLChatMessageHistory } from "@langchain/azure-cosmosdb";

// BAD: If container partition key is /userId but you query by sessionId,
// lookups become cross-partition scans
const history = new AzureCosmosDBNoSQLChatMessageHistory({
  endpoint: process.env.COSMOS_ENDPOINT,
  credential,
  databaseName: "mydb",
  containerName: "chat-history", // partitioned by /userId
  sessionId: "session-123",     // queries will fan out across partitions
});
```

**Correct (persistent chat history with proper session isolation):**

```typescript
import { AzureCosmosDBNoSQLChatMessageHistory } from "@langchain/azure-cosmosdb";
import { DefaultAzureCredential } from "@azure/identity";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";

const credential = new DefaultAzureCredential();

const model = new ChatOpenAI({
  azureOpenAIApiDeploymentName: "gpt-4o",
});

// Factory function creates history per session
function getMessageHistory(sessionId: string) {
  return new AzureCosmosDBNoSQLChatMessageHistory({
    endpoint: process.env.COSMOS_ENDPOINT,
    credential,
    databaseName: "mydb",
    containerName: "chat-history", // partition key should be /sessionId
    sessionId,
  });
}

// Wrap model with persistent history
const withHistory = new RunnableWithMessageHistory({
  runnable: model,
  getMessageHistory,
  inputMessagesKey: "input",
  historyMessagesKey: "history",
});

// Invoke with session tracking — messages persist across restarts
const response = await withHistory.invoke(
  { input: "What did we discuss earlier?" },
  { configurable: { sessionId: "user-123-session-456" } }
);
```

**Container design tips:**
- Use `/sessionId` as partition key for efficient single-session retrieval
- Enable TTL to auto-expire old conversations (e.g., 30 days)
- Use a composite index on `sessionId` + `_ts` if you query history by time range

Reference: [LangChain.js Azure Cosmos DB Chat History](https://js.langchain.com/docs/integrations/chat_memory/azure_cosmosdb_nosql/)
