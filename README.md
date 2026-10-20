# Azure Cosmos DB for VS Code

<!-- region exclude-from-marketplace -->

[![Build Status](https://dev.azure.com/msdata/CosmosDB/_apis/build/status%2FVSCode%20Extensions%2Fvscode-cosmosdb?repoName=microsoft%2Fvscode-cosmosdb&branchName=main)](https://dev.azure.com/msdata/CosmosDB/_build/latest?definitionId=51963&repoName=microsoft%2Fvscode-cosmosdb&branchName=main)
[![License](https://img.shields.io/github/license/microsoft/vscode-cosmosdb)](LICENSE.md)

<!-- endregion exclude-from-marketplace -->

Connect to **Azure Cosmos DB for NoSQL** from VS Code to explore accounts, manage databases and containers, edit items, and run queries without leaving your editor. Work with Azure accounts, connection strings, or the local Azure Cosmos DB Emulator.

[Install from the Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) | [Read the documentation](https://learn.microsoft.com/azure/cosmos-db/) | [Report an issue](https://github.com/microsoft/vscode-cosmosdb/issues/new/choose)

![Azure Cosmos DB Extension](resources/readme/overview.gif)

## Get Started

<!-- prettier-ignore -->
1. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-cosmosdb) or search for **Azure Cosmos DB** in the VS Code Extensions view.
2. Open the **Azure** view in the Activity Bar and choose how to connect:
   - Sign in to Azure to browse Cosmos DB accounts across your subscriptions.
   - Select **New Connection…** to attach an account with a connection string.
   - Select **New Emulator Connection** under **Local Emulators** to use a local development instance.

3. Expand an account, database, and container. Use the context menu to create or open items, import documents, or launch the Query Editor.
4. Run a query such as `SELECT * FROM c`, then inspect the results as a table, JSON, or tree. Query metrics and index recommendations help you tune the request.

> Don't have an account? [Create an Azure account](https://azure.microsoft.com/free/) or use the [Azure Cosmos DB Emulator](https://learn.microsoft.com/azure/cosmos-db/emulator) for local development.

## Features

| Capability                 | What you can do                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Explore resources          | Browse subscriptions, accounts, databases, containers, items, and server-side scripts.                  |
| Manage data                | Create, edit, delete, and import JSON documents with validation and syntax highlighting.                |
| Build and optimize queries | Use completions and diagnostics, compare result views, inspect request charge, and review index advice. |
| Monitor account health     | Review throughput, RU consumption, partitions, alerts, and recommendations from the account dashboard.  |
| Work locally               | Attach the Azure Cosmos DB Emulator or a connection string without depending on subscription discovery. |
| Use GitHub Copilot         | Generate, edit, and explain Azure Cosmos DB for NoSQL queries from natural-language requests.           |

## Azure Cosmos DB Explorer

The Azure Cosmos DB Explorer helps you find, view, and manage your Azure Cosmos DB databases.

- **Discover Database Accounts**: Scan your Azure subscriptions for available database accounts and browse their resources.

- **Open in Azure Portal**: Open an account directly in the Azure portal for service-level configuration.

- **Manage Resources**: View, create, and delete databases, containers, stored procedures, triggers, and documents.

- **Edit Documents and Scripts**: Open documents and stored procedures in the editor, then save changes to the service.

- **Filter and Sort**: Narrow large resource trees and choose the order that best fits your workflow.

- **Workspace Connections**: Attach database accounts with connection strings, including accounts that are not discoverable through your current Azure subscriptions.

## Account Overview Dashboard

The Account Overview Dashboard gives you an at-a-glance view of a Cosmos DB account: inventory, provisioned vs. normalized RU consumption, partition health, active alerts, and recommendations. Open **Account Overview → Overview** from an account node in the Explorer.

The dashboard has three tabs: **Monitoring**, **Databases and Containers**, and **Advisories**. The Account Overview submenu also provides shortcuts to each monitoring metric and to Advisories. Metric shortcuts select the corresponding card and focus its chart in the existing Monitoring tab, preserving the time range and database scope; they do not open separate dashboards.

Expand **Account details** for **View Cost**, **View JSON**, and **Additional account properties**. **View Cost** opens Azure Portal Cost Analysis scoped to the account in its Azure cloud. **View JSON** retrieves the account resource from Azure Resource Manager and opens formatted JSON in VS Code without requesting keys or connection strings. The action bar reuses the existing database/container creation wizards and account deletion confirmation. **Add container** uses the database selected in the header; with **All databases**, it first asks you to choose a database within this account, including empty databases. These creation/deletion actions require the corresponding Azure write permissions. **Try Data Modeler** is currently a disabled preview placeholder.

While **Add database** or **Add container** runs its native VS Code wizard, Overview is dimmed and unavailable to mouse and keyboard interaction. Cancel in the wizard to return without changes. After successful creation, Overview unlocks once inventory refresh finishes. Failures appear in a Fluent error message bar and are announced assertively to screen readers without moving focus.

Overview loads on opening and does not auto-refresh, including when you return to the editor. **Refresh** reloads every section, including inventory metrics, the selected container's partition telemetry, alerts and advisories. Changing a filter reloads only the data that depends on it. The header shows the local date and time when the displayed metric charts were generated, to the left of the filters; this is not the freshness timestamp for every section or the latest Azure metric sample.

The **Refresh** button shows a spinner for an explicit Refresh or a metric time/database-scope change, not for the initial load. Its label stays **Refresh**, with no separate updating text. Refresh and the header's database/time-range selectors are unavailable while data requests finish, including initial loading, so another filter change cannot overlap the current load. They become available again after completion or failure, retaining the selected values. Each section retains its own loading state. User-requested updates are announced to screen readers.

Every section reads from Azure Resource Manager and Azure Monitor. When a section can't load, it shows an explicit empty state instead of a blank panel:

- **No data** — the account is healthy but has no data for the selected window.
- **Not supported** — the section doesn't apply to this account's API (for example, inventory metrics are only available for NoSQL (Core) API accounts).
- **Access required** — your Azure role doesn't grant permission to read the underlying data.

### Required Azure roles

Data is fetched with your Azure credentials, so each section requires the corresponding role assignment. If a role is missing, that section shows an "Access required" empty state naming the role below; the rest of the dashboard continues to work.

| Dashboard section                                      | Minimum Azure role              |
| ------------------------------------------------------ | ------------------------------- |
| Account header, inventory, throughput                  | Reader on the Cosmos DB account |
| RU trends, partition health, Tier-1 derived advisories | Monitoring Reader               |
| Tier-2 (log-based) derived advisories                  | Log Analytics Reader            |
| Active alerts                                          | Monitoring Reader               |
| Advisor recommendations                                | Reader on the subscription      |

Tier-2 derived advisories (cross-partition query fan-out, shard-key misalignment, uncontrolled ingestion, and shared-throughput starvation) additionally read the account's `CDB*` diagnostic-log tables, so they require **Diagnostic Settings → Log Analytics** enabled on the account plus the [Log Analytics Reader](https://learn.microsoft.com/azure/role-based-access-control/built-in-roles/monitor#log-analytics-reader) role (Monitoring Reader also works). When these are missing, the Derived Advisories card still renders every Tier-1 advisory and flags the Tier-2 gap with a "Partial coverage" notice.

Derived advisory explanations, suggested actions and threshold references highlight numeric evidence and its units on a subtle theme-aware background. Their underlying strings remain readable plain text: paired backticks mark a highlighted phrase (for example, `` `400 RU/s` ``), not HTML or general Markdown. Translations retain those delimiters around the complete value and unit in the translated word order. Literal backticks and backslashes in resource names or query text are escaped before interpolation. Highlights remain ordinary inline text for screen readers, without extra announcements or keyboard stops.

Learn more about assigning roles in [Azure role-based access control](https://learn.microsoft.com/azure/role-based-access-control/overview).

For the metrics, detections, and ARM endpoints behind the dashboard, see [`docs/account-overview-dashboard.md`](./docs/account-overview-dashboard.md).

## Data Modeler

**Data Modeler (Preview)** helps you choose partition keys for Azure Cosmos DB for NoSQL using GitHub Copilot.
Open it with **Try Data Modeler** in **Account Overview**, from an account in **Explorer**, or run
**Data Modeling Wizard** from the Command Palette. Requires available
GitHub Copilot models and AI features enabled.

1. Choose a workload template or define your own schemas, queries, and scale estimates.
2. Compare single-path partition-key recommendations, query routing, and warnings. Review assumptions before deploying.
3. Deploy selected databases and containers directly, or export editable **Bicep**, **Terraform**, or **C# SDK** code.
   Deployment requires resource-creation permissions and may incur Azure charges; it does not upload documents.

Work is saved locally per account so you can resume later; saved sessions expire 30 days after their last save.
To permanently clear local Data Modeler data for every account, run **Cosmos DB: Delete All Data Modeler Data**
from the Command Palette and confirm. This closes all Data Modeler tabs and removes saved sessions, including legacy
data. It does not delete deployed databases or containers, saved container schemas, or query history.
See [modeling details](docs/data-modeler-scale.md) and the [telemetry inventory](docs/data-modeler-telemetry.md) for more.

## Query Editor

The Query Editor provides a focused workspace for writing, running, and tuning Azure Cosmos DB for NoSQL queries.

- **Language Support**: Get syntax highlighting, completions, diagnostics, hover documentation, signature help, and formatting. Schema-aware suggestions include properties discovered in the active container.

- **Query History**: Automatically saves previously executed queries, allowing you to open and reuse them later.

- **Run Queries**: Execute queries and view results in Table, JSON, or Tree view.

- **Export Results**: Provides options to copy query results as JSON or CSV or to save them to a file for later use.

- **Pagination**: Adjust how many results are displayed at a time when working with large datasets.

- **Query Insights and Index Advisor**: Review execution time, request charge, response size, activity ID, and indexing recommendations.

- **Edit Documents**: Open, update, and save individual documents.

- **Create New Documents**: Write and validate documents with syntax highlighting.

![Query Editor result views](resources/readme/queryEditor.gif)

### Keyboard Shortcuts

The Azure Cosmos DB extension supports various keyboard shortcuts to improve your productivity when working with queries and documents.

For a complete list of keyboard shortcuts, see [Keyboard Shortcuts](docs/hotkeys/01_keyboard_shortcuts.md).

## AI-Powered Query Assistance (GitHub Copilot)

The extension integrates with GitHub Copilot to help you write, edit, and understand Cosmos DB NoSQL queries using natural language.

- **Generate Query**: Click the **AI** button in the Query Editor toolbar and select **Generate query** to describe your query in plain English. Copilot will generate a Cosmos DB NoSQL query for you.

- **Explain Query**: Click the **AI** button and select **Explain query** to get a plain-English explanation of the current query in the editor.

> **Requires** the [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) extension and an active Copilot subscription.

For more details, see the [AI Chat documentation](src/chat/README.md).

## Import into Azure Cosmos DB

The extension allows you to import documents into Azure Cosmos DB.

- **Workspace Integration**: Use the context menu of a container or JSON document file to start an import.

  ![Import documents](resources/readme/import_documents.gif)

## Attach to the Azure Cosmos DB Emulator

Attach the Azure Cosmos DB Emulator to work with a local instance of Azure Cosmos DB for development and testing purposes.

- **Emulator Installation**: Install and run the [Azure Cosmos DB Emulator](https://learn.microsoft.com/azure/cosmos-db/emulator) on your local machine.

- **New Emulator Connection**: Expand **Cosmos DB Accounts**, then **Local Emulators**, and select **New Emulator Connection** to attach the emulator to your workspace.

For local setup instructions and connection details, see [Azure Cosmos DB Emulator](docs/cosmosdb-emulator.md).

## Corporate proxies

Normal Cosmos DB for NoSQL connections delegate proxy handling to VS Code. See
[VS Code network configuration](https://code.visualstudio.com/docs/setup/network) for proxy, authentication,
and certificate guidance.

**Emulator exception:** local `localhost` and `127.0.0.1` emulators remain direct and retain their self-signed
certificate handling. Emulator connections supply an explicit TLS agent, so `http.proxySupport: "on"` does not
add proxy routing for them. A remotely hosted emulator requiring a proxy needs `fallback` or `override`
and appropriate certificate trust.

## Known Issues

> [!WARNING]
> Support for previously included features such as MongoDB, PostgreSQL, Graph (Gremlin), Table, Cassandra, and the Grammar Language Server has been removed from this extension.
>
> - For MongoDB support, use the [DocumentDB Extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-documentdb).
> - For PostgreSQL support, use the [PostgreSQL Extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-ossdata.vscode-pgsql).

<!-- region exclude-from-marketplace -->

## How to Contribute

This project welcomes contributions and suggestions. To contribute, see these documents:

- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

<!-- endregion exclude-from-marketplace -->

## Telemetry

Data Modeler template downloads report a `downloadCode` action with the template format, outcome
(`success`, `cancelled`, or `error`), and whether the code was edited. These events use the existing Data Modeler
telemetry context and do not include database names, filenames, paths, code contents, or raw error messages.

VS Code collects usage data and sends it to Microsoft to help improve our products and services. Read our [privacy statement](https://go.microsoft.com/fwlink/?LinkID=521839) to learn more. If you don’t wish to send usage data to Microsoft, you can set the `telemetry.enableTelemetry` setting to `false`. If you want to disable feedback requests in VS Code, set `telemetry.feedback.enabled` to `false`. Learn more in our [FAQ](https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting).

**Data Collection.** The software may collect information about you and your use of the software and send it to Microsoft. Microsoft may use this information to provide services and improve our products and services. You may turn off the telemetry as described in the repository. There are also some features in the software that may enable you and Microsoft to collect data from users of your applications. If you use these features, you must comply with applicable law, including providing appropriate notices to users of your applications together with a copy of Microsoft’s privacy statement. Our privacy statement is located at https://go.microsoft.com/fwlink/?LinkID=521839. You can learn more about data collection and use in the help documentation and our privacy statement. Your use of the software operates as your consent to these practices.

## License

[MIT](LICENSE.md)
