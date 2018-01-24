# Change Log
All notable changes to the "azure-cosmosdb" extension will be documented in this file.

## 0.4.0 - 2018-01-25
### Added
- Attach to Cosmos DB emulator
- Run commands from the command palette

### Fixed
- [Bugs fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A%220.4.0%22+is%3Aclosed+label%3Abug)

## 0.3.0 - 2017-12-15
### Added
- Attach Cosmos DB accounts by connection string
- Graph:
  - Customize the color and display text of vertices through VS Code [settings](README.md#graphSettings)
  - By default display vertex IDs and labels and choose vertex color based on label
  - Honor current VS Code theme

### Fixed
- [Bugs fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A%220.3.0%22+is%3Aclosed+label%3Abug)

## 0.2.2 - 2017-12-04
### Added
- View, edit, and persist a Mongo collection
- Edit and persist the result of a Mongo command

## 0.2.1 - 2017-11-16
### Fixed
- [Graph bugs fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A%220.2.1%22+is%3Aclosed+label%3Abug)
  - Source to target arrows are backwards
  - Side effects from executing a Gremlin query can occur twice
  - Duplicate vertices can show up in graph viewer
  - Query performance improved for large graphs

## 0.2.0 - 2017-11-10
### Added
- Graph:
  - View/Create/Delete databases and graphs
  - Click on a graph to visualize data
  - Query graph using [Gremlin](https://docs.microsoft.com/azure/cosmos-db/gremlin-support)
- DocumentDB:
  - View/Create/Delete databases, collections, and documents
- Mongo
  - View documents in the explorer
- DocumentDB and Mongo:
  - Click on a document to open in the editor
  - Edit a document and persist changes to the cloud


### Removed
- View Mongo documents in 'result.json' by clicking on a collection in the explorer
- Edit and persist the result of a Mongo scrapbook command

### Fixed
- [Bugs fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A%220.2.0%22+is%3Aclosed+label%3Abug)

## 0.1.1 - 2017-09-19
### Changed
- Correctly set version to preview

## 0.1.0 - 2017-09-19
### Added
- Cosmos DB UI component (sash)
- Connect to local MongoDB
- Create Cosmos DB (with MongoDB adaptor)
- Connect to Cosmos DB via MongoDB adaptor
- Command to launch the `mongo` shell
- Rich MongoDB intellisense in scrapbooks
