# Azure Cosmos DB Emulator

## What is the Azure Cosmos DB emulator?

The Azure Cosmos DB emulator provides a local environment that emulates the Azure Cosmos DB service designed for development purposes. Using the emulator, you can develop and test your application locally, without creating an Azure subscription or incurring any service costs. When you're satisfied with how your application is working with the emulator, you can transition to using an Azure Cosmos DB account with minimal friction.

> **Important:** We do not recommend the use of the emulator for production workloads.

For more information, see the official documentation: https://learn.microsoft.com/en-us/azure/cosmos-db/emulator

## Set up the emulator in VS Code

In **Cosmos DB Accounts → Local Emulators**, choose **Set up Azure Cosmos DB Emulator**. Select a
local Docker Engine 28 or later or Podman (4.9 or later on Linux, 5 or later on Windows and macOS)
running Linux containers. Docker Desktop is not required.
On Windows and macOS, create and start a Podman machine before attempting setup with Podman.
If the CLI is missing, the wizard links to the engine's installation instructions. Fully restart
VS Code if the installer changed `PATH`.

The wizard checks and publishes the SDK endpoint (`8081`) and Data Explorer (`1234`) on `127.0.0.1`
by default. If a port is occupied, choose a different one. Setup creates a managed data volume and
saves the connection without asking for a key. If verification times out, **Wait longer** retries
the SDK check against the same container. VS Code trusts the emulator's certificate only for
that managed connection; setup does not change the system or VS Code certificate store.

The managed node exposes lifecycle actions. Stop, restart, reloading VS Code, and recreating a
missing container retain the named volume. **Delete Emulator** permanently removes the managed
container and its data after confirmation. Failed or cancelled setup cleans up resources created
by that attempt; the pulled image may remain cached. If the engine is unavailable during cleanup,
start or reconnect to the same engine and refresh the Local Emulators tree. Use
**New Emulator Connection…** to attach an emulator that you manage yourself.

## Running the emulator for extension development

This project includes a `docker-compose.yml` for running the Linux-based Azure Cosmos DB emulator.

### Prerequisites

- Docker Desktop installed and running

### Start the Emulator

```sh
docker-compose up -d
```

### Stop the Emulator

```sh
docker-compose down
```

### Stop and Remove Data

```sh
docker-compose down -v
```

## Authentication

Every request made against the emulator must be authenticated using a key over TLS/SSL. The emulator ships with a single account configured to use a well-known authentication key.

| Setting           | Value                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Endpoint          | `localhost:8081`                                                                                                                               |
| Key               | `C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==`                                                     |
| Connection String | `AccountEndpoint=https://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==;` |

## Differences Between the Emulator and Cloud Service

The emulator provides an environment on your developer workspace that isn't capable of emulating every aspect of the Azure Cosmos DB service. Here are a few key differences:

- The emulator's Data Explorer pane is only supported in the API for NoSQL and API for MongoDB.
- The emulator only supports provisioned throughput (not serverless).
- The emulator uses a well-known key when it starts. You can't regenerate the key for the running emulator.
- The emulator can't be replicated across geographical regions or multiple instances.
- The emulator ideally supports up to 10 fixed-size containers at 400 RU/s or 5 unlimited-size containers.
- The emulator only supports the Session and Strong consistency levels.
- The emulator constrains the unique identifier of items to a size of 254 characters.
- The emulator supports a maximum of five JOIN statements per query.
- The emulator's features may lag behind the pace of new features for the cloud service.

## Additional Resources

- [Linux Emulator Documentation](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator-linux)
- [Azure Cosmos DB Emulator Overview](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator)
