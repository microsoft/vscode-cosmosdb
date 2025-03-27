# Azure Resources View Integration

_Last update: 24-Mar-2025_

This directory contains code that integrates CosmosDB resources with the Azure Resources tree view in VS Code. It provides the necessary components to display CosmosDB resources in the Azure view and to handle their interactions.

## Folder Structure

```
azure-resources-view/
├── cosmosdb/                   # Contains base components for CosmosDB integration
│   ├── CosmosDBAccountResourceItemBase.ts
│   └── CosmosDBBranchDataProvider.ts
└── documentdb/                 # Contains MongoDB-specific implementations
    ├── mongo-ru/               # MongoDB RU resources
    │   └── MongoRUResourceItem.ts
    └── mongo-vcore/            # MongoDB VCore resources
        ├── MongoVCoreBranchDataProvider.ts
        └── MongoVCoreResourceItem.ts
```

## Overview

### Cosmos DB

The main entry point for integration with the Azure Resources tree view. This provider:

1. Creates specific resource items based on the type of CosmosDB resource
2. For MongoDB resources, it creates a `MongoRUResourceItem`
3. For other CosmosDB resources (Cassandra, Core, Graph, Table), it creates the corresponding resource items

### Document DB (MongoDB RU + MongoDB vCore)

- **MongoDB RU Resource**: The `mongo-ru` folder contains only the `MongoRUResourceItem.ts` file which defines how MongoDB RU resources are displayed and interacted with.
  **It doesn't have its own branch data provider because it uses the main `CosmosDBBranchDataProvider`.**

- **MongoDB VCore Resource**: The `mongo-vcore` folder contains both a resource item (`MongoVCoreResourceItem.ts`) and a dedicated branch data provider (`MongoVCoreBranchDataProvider.ts`). This is because MongoDB VCore is a separate Azure resource type that requires its own handling logic.
