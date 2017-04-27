# Contributing

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.


# Development

## Prerequisites

- Install Mongo DB and Mongo shell [here](https://docs.mongodb.com/manual/installation/)

## Running the extension

- Clone the repository
- Open terminal and run `npm install`
- Build: `Tasks: Run Build Task`
- Debug: `Debug: Start Debugging`


# Features

## Mongo explorer view

- Open Mongo Explorer view `View: Show Mongo`
- Add a server by clicking the `+` button in the title. Connection string for local Mongo DB: `mongodb://localhost:27017`. **Note**: Start Mongo DB locally for connecting.
- Expand the connected server to see the DBs
- Remove the server by right clicking on the server and selecting `Remove Server` action.

## Mongo shell playground

### Prerequisites
- Configure the user setting `mongo.shell.path` to mongo shell executable path.

- Click on any DB to open the Mongo shell playground editor
- Type some scripts, eg: `db.<collectionName>.find()`
- Intelli-sense will be provided to write scripts
- Select the script, right click and execute script to see results.