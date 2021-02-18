# Change Log

All notable changes to the "azure-cosmosdb" extension will be documented in this file.

## 0.16.0 - 2021-02-23
### Added
- Now depends on the "Azure Resources" extension, which provides a "Resource Groups" and "Help and Feedback" view
- "Attached Emulator..." option added to Attach Database Accounts contest menu

### Changed
- "Report an Issue" button was removed from errors. Use the "Help and Feedback" view or command palette instead
- Grouped items in all context menus to improve access and readability

### Fixed
- [Bugs Fixed](https://github.com/microsoft/vscode-cosmosdb/milestone/29?closed=1)

## 0.15.1 - 2020-12-04
### Added
- Newly created Azure CosmosDB - MongoDB servers default to version “3.6”

### Changed
- Minimum version of VS Code is now 1.48.0
- Improved extension activation time (by switching to the azure-sdk-for-js)

### Fixed
- [Bugs Fixed](https://github.com/microsoft/vscode-cosmosdb/milestone/25?closed=1)

## 0.15.0 - 2020-09-15
### Added
- Attach PostgreSQL servers by connection string
- PostgreSQL support for integration with App Service extension

### Changed
- PostgreSQL server defaults to version "10"

### Fixed
- [Bugs fixed](https://github.com/microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A0.15.0+is%3Aclosed)

## 0.14.0 - 2020-07-14
### Added
- Use the setting "azureDatabases.batchSize" to configure the Mongo "DBQuery.shellBatchSize" attribute and the batch size when loading children in the tree view.
- Create and edit stored procedures in PostgreSQL. NOTE: only applies to PostgreSQL server versions 11 and above.

### Fixed
- [Bugs fixed](https://github.com/microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A0.14.0+is%3Aclosed)

### Changed
- Results from executing most Mongo commands open in a single read-only editor.

## 0.13.0 - 2020-05-28
In this release, we're rebranding the Cosmos DB Extension to Azure Databases to expand our database support beyond just Cosmos DB. This release also marks the first new database engine: PostgreSQL with other database engines coming later this year.
### Added
- PostgreSQL support
  - Create and view PostgreSQL servers, databases, and functions.
  - Create, edit, and execute PostgreSQL queries

### Fixed
- [Bugs fixed](https://github.com/microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A0.13.0+is%3Aclosed)

### Changed
- Viewing and querying Azure Cosmos DB graphs has been moved to a separate graph-specific extension, [vscode-cosmosdbgraph](https://github.com/microsoft/vscode-cosmosdbgraph)

## 0.12.2 - 2020-03-10
### Fixed
- Language client is not ready yet [#1334](https://github.com/microsoft/vscode-cosmosdb/issues/1334)

## 0.12.1 - 2020-01-22
### Fixed
- When updating a Mongo document, the operation would fail with the following error: `update operation document must contain atomic operators.` [#1298](https://github.com/microsoft/vscode-cosmosdb/issues/1298)
- When importing a `.json` document into a Mongo collection, it would throw the following error: `Error: r.insertedIds is not iterable` [#1307](https://github.com/microsoft/vscode-cosmosdb/issues/1307)

## 0.12.0 - 2020-01-16
### Added
- Support for Private Endpoint Connections
- Collapse All button for Cosmos DB explorer

### Fixed
- When using `find()` in MongoScrapbooks, it would not work properly with chained commands [#981](https://github.com/microsoft/vscode-cosmosdb/issues/981)
- [Bugs fixed](https://github.com/microsoft/vscode-cosmosdb/milestone/18?closed=1)

## 0.11.0 - 2019-09-03
### Added
- Add `mongo.shell.args` setting to allow passing arguments to mongo shell [#1104](https://github.com/Microsoft/vscode-cosmosdb/issues/1104), [#1126](https://github.com/Microsoft/vscode-cosmosdb/issues/1126)

### Changed
- Due to a change in the Azure Cosmos DB Emulator, users must explicitly enable the Mongo DB port when starting the emulator. Updated error messages to point to debugging tips at https://aka.ms/AA5zah5. [#1137](https://github.com/microsoft/vscode-cosmosdb/issues/1137), [#1000](https://github.com/microsoft/vscode-cosmosdb/issues/1000)

### Fixed
- Better shell error handling, add mongo.shell.args setting [#1101](https://github.com/Microsoft/vscode-cosmosdb/issues/1101), [#1092](https://github.com/Microsoft/vscode-cosmosdb/issues/1092), [#1071](https://github.com/Microsoft/vscode-cosmosdb/issues/1071), [#988](https://github.com/Microsoft/vscode-cosmosdb/issues/988), [#838](https://github.com/Microsoft/vscode-cosmosdb/issues/838), [#820](https://github.com/Microsoft/vscode-cosmosdb/issues/820)
- Increase mongo.shell.timeout default value from 5 to 30 [#1115](https://github.com/Microsoft/vscode-cosmosdb/issues/1115)
- Fix document save prompt message [#1021](https://github.com/Microsoft/vscode-cosmosdb/issues/1021)

## 0.10.2 - 2019-05-01
### Fixed
- Handle opening resources to use native vscode APIs
- Running the extension in older versions of VS Code
- Report an issue opening a blank webpage due to a large stack frame

## 0.10.1 - 2019-03-26
### Added
- Wizards are more informative and allow you to redo some steps

### Fixed
- Graph views moved from using previewHtml (deprecated) to Webview API

## 0.10.0 - 2019-02-13
### Added
* Improved startup and installation performance

### Fixed
* Accounts created in portal are not recognized as graph/mongo by the extension [#1018](https://github.com/Microsoft/vscode-cosmosdb/issues/1018)
* Confusing error message when running 'Import Document into a Collection' with no Workspace opened [#961](https://github.com/Microsoft/vscode-cosmosdb/issues/961)
* Improve emulator connection error messages [#1016](https://github.com/Microsoft/vscode-cosmosdb/issues/1016)

## 0.9.1 - 2018-11-28
### Added
- API support for integration with [App Service extension](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-azureappservice)
- Multiple documents, collections, or stored procedures can be viewed/edited at once (thanks [@tec-goblin](https://github.com/tec-goblin))

### [Fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?q=is%3Aissue+milestone%3A0.9.1+label%3Abug+is%3Aclosed)
- Refresh button doesn't refresh attached accounts [#904](https://github.com/Microsoft/vscode-cosmosdb/issues/904)
- Some scrapbook parse errors were causing an error alert [#959](https://github.com/Microsoft/vscode-cosmosdb/pull/959)
- Downgrade event-stream version due to [event-stream#116](https://github.com/dominictarr/event-stream/issues/116)

## 0.9.0 - 2018-11-05
### Added
- Mongo
    - Support for [ObjectId, ISODate](https://github.com/Microsoft/vscode-cosmosdb/issues/769) and [regular expression](https://github.com/Microsoft/vscode-cosmosdb/issues/786) [(/pattern/flag)](https://github.com/Microsoft/vscode-cosmosdb/issues/667) syntax in the scrapbook
    - Support for [method chaining](https://github.com/Microsoft/vscode-cosmosdb/issues/785).
    - Ability to [change timeout](https://github.com/Microsoft/vscode-cosmosdb/issues/809) for commands in scrapbook
- Support [importing documents](https://github.com/Microsoft/vscode-cosmosdb/issues/404) into CosmosDB and Mongo databases.
- Support for [soveriegn clouds](https://github.com/Microsoft/vscode-cosmosdb/commit/5b573f535cdeba109d7ff037b914575e0172c6bd)
- Support creation of fixed collections and graphs [#295](https://github.com/Microsoft/vscode-cosmosdb/issues/295) and [#504](https://github.com/Microsoft/vscode-cosmosdb/issues/504)

### Fixed
- Collections having two documents of the same id will render properly [#588](https://github.com/Microsoft/vscode-cosmosdb/issues/588) and [#892](https://github.com/Microsoft/vscode-cosmosdb/issues/892)
- Some UI fixes [#576](https://github.com/Microsoft/vscode-cosmosdb/issues/576) and [#873](https://github.com/Microsoft/vscode-cosmosdb/issues/873)
- [Additional bugs fixed](https://github.com/Microsoft/vscode-cosmosdb/milestone/16?closed=1)

### Thank you
A big thank you to the following contributors that helped make the extension even better!
- [Nicolas Kyriazopuolos-Panagiotopoulos @tec-goblin](https://github.com/tec-goblin):
    - Updates to a collection now update the corresponding tree item [PR#856](https://github.com/Microsoft/vscode-cosmosdb/pull/856)
    - Uploading a document by closing it no longer tries to update the closed editor  [PR#818](https://github.com/Microsoft/vscode-cosmosdb/pull/818)
    - Fixing tslint issues [PR#829](https://github.com/Microsoft/vscode-cosmosdb/pull/829)
    - Use consistent language for various commands [PR#828](https://github.com/Microsoft/vscode-cosmosdb/pull/828)
    - Fix some typos [PR#810](https://github.com/Microsoft/vscode-cosmosdb/pull/810) and [PR#816](https://github.com/Microsoft/vscode-cosmosdb/pull/816)
- [Nguyen Long Nhat @torn4dom4n](https://github.com/torn4dom4n), for updating our tasks [PR#887](https://github.com/Microsoft/vscode-cosmosdb/pull/887)

## 0.8.0 - 2018-07-05
### Added
- Improved scrapbook experience with better error handling. We now [highlight errors on the scrapbook as you type](https://github.com/Microsoft/vscode-cosmosdb/issues/471)!
- See your [stored procedures for graph accounts](https://github.com/Microsoft/vscode-cosmosdb/issues/422) too!
- [Document labels](https://github.com/Microsoft/vscode-cosmosdb/issues/381) in the tree view are now more descriptive.

### Fixed
- Scrapbook: can now parse commands with [single quotes](https://github.com/Microsoft/vscode-cosmosdb/issues/467) or [no quotes](https://github.com/Microsoft/vscode-cosmosdb/issues/467). Examples from the mongo docs should now work when directly pasted.
- Fewer timeout errors on [running commands in the emulator](https://github.com/Microsoft/vscode-cosmosdb/pull/731).
- We correctly parse [collection names with dots](https://github.com/Microsoft/vscode-cosmosdb/issues/666)
- Invalid database accounts will not [prevent the tree from loading](https://github.com/Microsoft/vscode-cosmosdb/issues/628)
- [Additional bugs fixed](https://github.com/Microsoft/vscode-cosmosdb/issues?page=1&q=is%3Aissue+milestone%3A0.8.0+is%3Aclosed)

## 0.7.2 - 2018-06-08

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
