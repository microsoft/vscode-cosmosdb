# Change Log

All notable changes to the "azure-cosmosdb" extension will be documented in this file.

## 0.7.2 - 2018-06-11

### Added
- [Support DNS Seedlist Connection Format](https://github.com/Microsoft/vscode-cosmosdb/pull/670) for mongo connection strings (mongodb+srv://). Thanks [@plusn-nuri](https://github.com/plusn-nuri)!

### Fixed
- [Support for Extended JSON in scrapbook queries](https://github.com/Microsoft/vscode-cosmosdb/issues/621)
- [Updating mongo documents without an ObjectID in the ID field ](https://github.com/Microsoft/vscode-cosmosdb/issues/534)
- [Log of fixed bugs](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A0.7.2+is%3Aclosed)


## 0.7.1 - 2018-05-10

### [Fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A%220.7.1%22+is%3Aclosed+label%3Abug)

- Fixed error "Unexpected Experience Value" when retrieving database accounts

## 0.7.0 - 2018-05-04

### Added
- Mongo
  - CodeLens support for scrapbook
  - Execute all commands in a scrapbook, allowing you to use scrapbooks as scripts
  - Support for ObjectIDs, ISODate, and extended JSON data types in document views

- SQL
  - View, open, edit and update Stored Procedures

- Miscellaneous
  - Error messages are now modal
  - Open newly created docs in editor

### Changed
- Moved Azure CosmosDB Explorer to new Azure view container instead of file explorer

### Fixed
- [Better error messages for connection strings](https://github.com/Microsoft/vscode-cosmosdb/pull/600)
- [Don't throw errors on dropping non-existent collections](https://github.com/Microsoft/vscode-cosmosdb/pull/541)
- [Errors no longer written to output in the middle of writing a scrapbook command](https://github.com/Microsoft/vscode-cosmosdb/issues/516)
- [Additional bugs fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A%220.7.0%22+is%3Aclosed+label%3Abug)


## 0.6.0 - 2018-04-09

### Added

- Mongo
  - mongo.shell.path setting no longer required if shell is in system path
  - Allow mongo.shell.path to be specified in workspace settings as well as user settings
  - No longer asking for an id for new documents
  - Connected database is now persisted between sessions
  - Improvements to scrapbook setup and error handling

- Azure subscriptions
  - New "filter" button on subscription nodes
  - New "Open in Portal" menu item for subscriptions

- Miscellaneous
  - New "Report an Issue" button on error dialogs

### Fixed

- [Allow access to multi-tenant mongo server](https://github.com/Microsoft/vscode-cosmosdb/issues/473)
- [Can only run the first command in a Mongo Scrapbook on Windows](https://github.com/Microsoft/vscode-cosmosdb/issues/386)
- [Projections Not Working In Mongo Scrapbooks](https://github.com/Microsoft/vscode-cosmosdb/issues/214)
- [Additional bugs fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A%220.6.0%22+is%3Aclosed+label%3Abug)

## 0.5.1 - 2018-03-23

### Fixed
- [Bug fixed](https://github.com/Microsoft/vscode-cosmosdb/issues/372)
## 0.5.0 - 2018-03-05

### Fixed

- [Bugs fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A%220.5.0%22+is%3Aclosed+label%3Abug)

### Added

- DocumentDB and Mongo
  - Allow updating documents and collections re-opened from a previous VS Code session
- Mongo
  - Delete databases

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
