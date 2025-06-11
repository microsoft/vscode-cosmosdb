# Azure Databases for VS Code (Preview)

<!-- region exclude-from-marketplace -->

[![Version](https://img.shields.io/visual-studio-marketplace/v/ms-azuretools.vscode-cosmosdb.svg)](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) [![Installs](https://img.shields.io/visual-studio-marketplace/i/ms-azuretools.vscode-cosmosdb.svg)](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) [![Build Status](https://dev.azure.com/ms-azuretools/AzCode/_apis/build/status/vscode-cosmosdb)](https://dev.azure.com/ms-azuretools/AzCode/_build/latest?definitionId=7)

<!-- endregion exclude-from-marketplace -->

Browse, manage, and query your Azure Cosmos DB databases both locally and in the cloud with support for **Azure Cosmos DB for NoSQL**.


![Azure Databases Extension](resources/readme/overview.png)

> Sign up today for your free Azure account and receive 12 months of free popular services, $200 free credit and 25+ always free services 👉 [Start Free](https://azure.microsoft.com/free/open-source).

# Features

## Azure Databases Explorer

The Azure Databases Explorer helps you find, view, and manage your Azure databases.

- **Discover Database Servers**: scan your Azure subscription for available database servers and get a structured list of your resources.


- **Open in Azure Portal**: Access database servers directly in the Azure portal.

- **Manage Databases**: View, create, and delete databases, collections, stored procedures, and documents.

- **Edit Documents and Queries**: Open documents, stored procedures, and queries in the editor.

- **Save Changes**:  Make updates and persist them to the cloud.

- **Workspace Support**: Attach database servers to your workspace using connection strings. This is especially useful for teams working with shared resources from various subscriptions.


## Query Editor

The Query Editor allows you to write and execute queries across your databases.

- **Rich Syntax Highlighting**: Highlights query syntax to make it more readable and help prevent errors.

- **Query History**: Automatically saves previously executed queries, allowing you to open and reuse them later.

- **Run Queries**: Execute queries and view results in Table, JSON, or Tree view.

- **Export Results**: Provides options to copy query results as JSON or CSV or to save them to a file for later use.

- **Pagination**: Adjust how many results are displayed at a time when working with large datasets.

- **Query Insights and Index Advisor**: Displays key details such as execution time, resource consumption, and indexing recommendations.

- **Edit Documents**: Open, update, and save individual documents.


- **Create New Documents**: Write and validate documents with syntax highlighting.

![Query Editor with Results](resources/readme/queryEditor.png)

## Import into Azure Cosmos DB

The extension allows you to import documents into CosmosDB.

- **Workspace Integration**: Use the context menu of a collection or document file (JSON) to initiate import.

  ![Import documents](resources/readme/import_documents.gif)

## Attach to the Azure Cosmos DB Emulator

Attach the Azure Cosmos DB Emulator to work with a local instance of Azure Cosmos DB for development and testing purposes.

- **Emulator Installation**: Install and run the [Azure Cosmos DB Emulator](https://docs.microsoft.com/azure/cosmos-db/local-emulator) on your local machine.

- **New Emulator Connection**: Expand 'CosmosDB Accounts', next expand 'Local Emulators', and select 'New Emulator Connection' to link the emulator to your workspace.

> [!WARNING]
> Support for previously included features such as Universal MongoDB has been moved to a separate extension. You can find it [here](https://github.com/microsoft/documentdb)

## Known Issues

Here are some known issues and limitations to be aware of when using the Azure Databases extension:

- **Gremlin Endpoint Limitation**: Azure no longer supports Gremlin queries on pre-GA graph accounts. If you encounter an error like "Could not find a valid gremlin endpoint for _graph_", open the graph node in the portal and verify the "Gremlin Endpoint" format. If it does not match the expected form '...[graph-name].**_gremlin_**.cosmosdb.azure.com...', you may need to create a new graph account.

- **Graphs Not Supported with Emulator**: Graphs are not currently supported with the Cosmos DB Emulator.

- **Table Viewing/Editing**: Viewing and editing tables is not currently supported by the extension.

- **Escaped Characters in Scrapbooks**: Scrapbook support for escaped characters is preliminary. Use double escaping for newlines (`\\n` instead of `\n`). If you find issues, report them to [#937](https://github.com/Microsoft/vscode-cosmosdb/issues/937).



<!-- region exclude-from-marketplace -->

# How to Contribute

To contribute, see these documents:

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

## Legal

Before we can accept your pull request, you will need to sign a **Contribution License Agreement**. All you need to do is to submit a pull request, then the PR will get appropriately labeled (e.g. `cla-required`, `cla-norequired`, `cla-signed`, `cla-already-signed`). If you already signed the agreement, we will continue with reviewing the PR, otherwise the system will tell you how you can sign the CLA. Once you sign the CLA, all future PRs will be labeled as `cla-signed`.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information, see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

# Telemetry

VS Code collects usage data and sends it to Microsoft to help improve our products and services. Read our [privacy statement](https://go.microsoft.com/fwlink/?LinkID=528096&clcid=0x409) to learn more. If you don’t wish to send usage data to Microsoft, you can set the `telemetry.enableTelemetry` setting to `false`. Learn more in our [FAQ](https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting).

# License

[MIT](LICENSE.md)
