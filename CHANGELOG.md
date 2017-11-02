# Change Log
All notable changes to the "azure-cosmosdb" extension will be documented in this file.

## 0.2.0 - 2017-11-02
### Added
DocumentDB and MongoDB accounts now support:
- View/Create/Delete databses, collections, and documents
- Click on a document to open in the editor
- Edit a document and persist changes to the cloud
- 'Load more' documents in the explorer

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
