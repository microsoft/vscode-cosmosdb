# CosmosDB Chat Participant

This directory contains the implementation of the `@cosmosdb` chat participant for VS Code.

## Overview

The CosmosDB chat participant is an AI-powered assistant that helps users with Azure Cosmos DB questions, best practices, and code examples. It leverages VS Code's language model API (GitHub Copilot) to provide intelligent, context-aware responses.

## Features

- **AI-Powered Responses**: Uses GitHub Copilot's language model for intelligent answers
- **CosmosDB Specialization**: Focused on Azure Cosmos DB topics and best practices
- **Chat Integration**: Responds to `@cosmosdb` mentions in VS Code chat
- **CosmosDB Branding**: Uses the official CosmosDB logo as the participant icon
- **Error Handling**: Graceful fallback when language models are unavailable

## Usage

1. Open VS Code chat (Ctrl+Alt+I or through the Command Palette)
2. Type `@cosmosdb` followed by your question about Cosmos DB
3. The assistant will provide AI-powered responses with:
   - Best practices and recommendations
   - Code examples and snippets
   - Query optimization advice
   - Troubleshooting help
   - Performance tuning tips

## Prerequisites

- GitHub Copilot extension must be installed and enabled
- Active GitHub Copilot subscription

## Implementation Details

- **File**: `cosmosDbChatParticipant.ts`
- **Registration**: Automatically registered during extension activation
- **Icon**: Uses `resources/icons/theme-agnostic/CosmosDBAccount.svg`
- **ID**: `cosmosdb`
- **LLM Integration**: Uses VS Code's `vscode.lm` API with Copilot models

## Example Queries

- `@cosmosdb How do I optimize a query in Cosmos DB?`
- `@cosmosdb What are the best practices for partition keys?`
- `@cosmosdb Show me how to use the .NET SDK for bulk operations`
- `@cosmosdb How can I reduce RU consumption?`

## Error Handling

The participant includes robust error handling for:

- Missing language models
- Network connectivity issues
- Content filter blocks
- Token cancellation requests
