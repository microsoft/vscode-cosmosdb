
# MongoDB NoSQL Support for VS Code

The MongoDB extension makes it easy to work with MongoDB NoSQL databases, collections, and documents. With this extension, you can:

* Connect to local or hosted (e.g. Azure CosmosDB) servers
* Create and view MongoDB databases and collections with the MongoDB Explorer
* Author MongoDB "Scrapbooks" with rich IntelliSense (completions) for MongoDB scripts, including collections
* Execute scripts and see results directly in VS Code
* Update documents in place

# Prerequisites

- Install [Mongo DB and Mongo shell](https://docs.mongodb.com/manual/installation/).

# Features

## Mongo Explorer

- Add a server by clicking the `+` button in the title.
  - Typical connection string for a local MongoDB instance: `mongodb://localhost:27017`
- Expand the connected server to see the Databases
- Click on a collection to see the documents
- Remove a server by right clicking on the server name and selecting the `Remove Server` command

## Mongo "Scrapbooks"

- Configure the user setting `mongo.shell.path` to your mongo shell executable path
- Click on any DB to open the Mongo shell playground editor
- Enter your scripts, eg: `db.<collectionName>.find()`
- IntelliSense (completions) will be provided as you write your scripts
- Select the script and press `CMD+'` (`CTRL+'` on Windows and Linux) to see the results
- Edit your documents, right click, and choose the `Update` command to persist changes to the database

# Contributing
There are a couple of ways you can contribute to this repo:

- **Ideas, feature requests and bugs**: We are open to all ideas and we want to get rid of bugs! Use the Issues section to either report a new issue, provide your ideas or contribute to existing threads.
- **Documentation**: Found a typo or strangely worded sentences? Submit a PR!
- **Code**: Contribute bug fixes, features or design changes:
  - Clone the repository locally and open in VS Code.
  - Open the terminal (press `CTRL+`\`) and run `npm install`.
  - To build, press `F1` and type in `Tasks: Run Build Task`.
  - Debug: press `F5` to start debugging the extension.

## Legal
Before we can accept your pull request you will need to sign a **Contribution License Agreement**. All you need to do is to submit a pull request, then the PR will get appropriately labelled (e.g. `cla-required`, `cla-norequired`, `cla-signed`, `cla-already-signed`). If you already signed the agreement we will continue with reviewing the PR, otherwise system will tell you how you can sign the CLA. Once you sign the CLA all future PR's will be labeled as `cla-signed`.

## Code of Conduct
This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License 
[MIT](LICENSE)
