
# Azure Databases for VS Code (Preview)

<!-- region exclude-from-marketplace -->

[![Version](https://vsmarketplacebadge.apphb.com/version/ms-azuretools.vscode-cosmosdb.svg)](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) [![Installs](https://vsmarketplacebadge.apphb.com/installs-short/ms-azuretools.vscode-cosmosdb.svg)](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) [![Build Status](https://dev.azure.com/ms-azuretools/AzCode/_apis/build/status/vscode-cosmosdb)](https://dev.azure.com/ms-azuretools/AzCode/_build/latest?definitionId=7)

<!-- endregion exclude-from-marketplace -->

Browse and query your Azure databases both locally and in the cloud using [_scrapbooks_](#mongo-scrapbooks) with rich Intellisense then connect to Azure to manage your PostgreSQL and Cosmos DB databases with support for MongoDB, Graph (Gremlin), and SQL (previously known as DocumentDB).

![Azure Databases Extension](resources/readme/overview.png)

> Sign up today for your free Azure account and receive 12 months of free popular services, $200 free credit and 25+ always free services 👉 [Start Free](https://azure.microsoft.com/free/open-source).

# Prerequisites

- Some less-common commands in the Mongo [scrapbook](#mongo-scrapbooks) and use of the Mongo shell require installing [Mongo DB and Mongo shell](https://docs.mongodb.com/manual/installation/).

# Features

## Azure Databases Explorer

- Create a database server by clicking the `+` button in the title
- View database servers and open directly in the portal
- View/Create/Delete databases, collections, graphs, stored procedures, documents, and queries
- Click on a document, stored procedure, or query to open in the editor
- Click on a graph to visualize data
- Query graph using [Gremlin](https://docs.microsoft.com/azure/cosmos-db/gremlin-support)
- Edit a document and persist changes to the cloud
- Attach a Mongo server by clicking the plug icon in the title

![Browse PostgreSQL, CosmosDB, and MongoDB databases](resources/readme/explorer.png)

## Mongo Scrapbooks
### Run Mongo Commands with Rich Intellisense

- View your MongoDB database account by by clicking "Sign in to Azure..." in the Azure Resources explorer or using "Attach Database Account" to connect via a connection string
- Optionally configure the settings `mongo.shell.path` and `mongo.shell.args` if your mongo executable is not already on your system's PATH (many of the common commands have built-in support and do not require the Mongo shell to be installed - see [Prerequisites](#prerequisites))
- Click on "New Mongo Scrapbook" in the tree title bar
- Click on "Connect to a database" to indicate which database to run the commands against
- Enter your commands and/or comments, eg: `db.<collectionName>.find()`
- IntelliSense (auto-completions) will be provided
- Click on "Execute" above a command to execute it, or press `CMD+"` (Mac) or `CTRL+"` (Windows and Linux) to execute the line with the cursor
- To run all commands, click on "Execute All", or press `CMD+:` or `Ctrl+:`
- Save and re-use later
![Mongo Scrapbook](resources/readme/Scrapbook.gif)

## Import into Cosmos DB

- You can now import documents from your workspace into CosmosDB. Use the context menu of a collection or a document file (json) to get started!
![Import documents](resources/readme/import_documents.gif)

## Use [Gremlin](https://docs.microsoft.com/azure/cosmos-db/gremlin-support) to query graphs

![Query Graphs](resources/readme/Graph.gif)

- <a name="graphSettings"></a>Configure the user setting `cosmosDB.graph.viewSettings` to customize which properties to display and which colors to use based on vertex label.
```javascript
    "cosmosDB.graph.viewSettings": [
        {
            "vertexSettings": [
                {
                    // Default settings for all vertices
                    "displayProperty": [
                        // Display name property if exists, otherwise firstName if it exists, otherwise ID
                        "name",
                        "firstName"
                    ],
                    // Auto-choose color by label
                    "color": "auto",
                    // Show label after display property
                    "showLabel": true
                },
                {
                    // These setting apply to vertices with the label 'person'
                    "appliesToLabel": "person",
                    "color": "blue"
                }
            ]
        }
    ]
```

## Create an Azure Databases Server

1. Sign in to your Azure Account by clicking "Sign in to Azure..." in the Azure Resources explorer
    >  If you don't already have an Azure Account, click "Create a Free Azure Account"
1. Select the 'plus' button to open the "Create Resource" menu

    ![Create resource](resources/readme/createResource.png)

1. Choose "Create Database Server..."

    ![Create Database Server](resources/readme/createDatabaseServer.png)

## Attach to the Cosmos DB Emulator

* Install and run the [Cosmos DB Emulator](https://docs.microsoft.com/azure/cosmos-db/local-emulator) on your local machine
* Right click 'Attached Database Accounts' and select 'Attach Emulator'

![Attach Emulator](resources/readme/attachEmulator.png)

## Known Issues

- Azure no longer supports gremlin queries on pre-GA graph accounts. If you see the error "Could not find a valid gremlin endpoint for *graph*", then choose "Open Portal" on the graph node and check the "Gremlin Endpoint" in the Overview tab. If it does not take the form of '...[graph-name].***gremlin***.cosmosdb.azure.com...', then you will need to create a new graph account using the Azure portal or the current version of the extension.
- Graphs are not currently supported with the emulator
- Viewing/editing tables is not currently supported
- Support for escapes in the scrapbooks is preliminary. We currently do not support escaped characters as is inside a string - the characters need to be double escaped. For example, newlines in the string should be  '\\\\n' instead of '\\n' to be recognized correctly. If you find any issues with how the scrapbook handles escapes, please add to issue [#937](https://github.com/Microsoft/vscode-cosmosdb/issues/937).

<!-- region exclude-from-marketplace -->

# Contributing
There are several ways you can contribute to our [repo](https://github.com/Microsoft/vscode-cosmosdb):

* **Ideas, feature requests and bugs**: We are open to all ideas and we want to get rid of bugs! Use the [Issues](https://github.com/Microsoft/vscode-cosmosdb/issues) section to report a new issue, provide your ideas or contribute to existing threads.
* **Documentation**: Found a typo or strangely worded sentences? Submit a PR!
* **Code**: Contribute bug fixes, features or design changes:
  * Clone the repository locally and open in VS Code.
  * Run "Extensions: Show Recommended Extensions" from the [command palette](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette) and install all extensions listed under "Workspace Recommendations"
  * Open the terminal (press <kbd>CTRL</kbd>+ <kbd>\`</kbd>) and run `npm install`.
  * To build, press <kbd>F1</kbd> and type in `Tasks: Run Build Task`.
  * Debug: press <kbd>F5</kbd> to start debugging the extension.

## Legal
Before we can accept your pull request you will need to sign a **Contribution License Agreement**. All you need to do is to submit a pull request, then the PR will get appropriately labelled (e.g. `cla-required`, `cla-norequired`, `cla-signed`, `cla-already-signed`). If you already signed the agreement we will continue with reviewing the PR, otherwise system will tell you how you can sign the CLA. Once you sign the CLA all future PR's will be labeled as `cla-signed`.

## Code of Conduct
This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

<!-- endregion exclude-from-marketplace -->

# Telemetry
VS Code collects usage data and sends it to Microsoft to help improve our products and services. Read our [privacy statement](https://go.microsoft.com/fwlink/?LinkID=528096&clcid=0x409) to learn more. If you don’t wish to send usage data to Microsoft, you can set the `telemetry.enableTelemetry` setting to `false`. Learn more in our [FAQ](https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting).

# License
[MIT](LICENSE.md)
