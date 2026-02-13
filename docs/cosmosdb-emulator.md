# Azure Cosmos DB Emulator

## What is the Azure Cosmos DB emulator?

The Azure Cosmos DB emulator provides a local environment that emulates the Azure Cosmos DB service designed for development purposes. Using the emulator, you can develop and test your application locally, without creating an Azure subscription or incurring any service costs. When you're satisfied with how your application is working with the emulator, you can transition to using an Azure Cosmos DB account with minimal friction.

> **Important:** We do not recommend the use of the emulator for production workloads.

For more information, see the official documentation: https://learn.microsoft.com/en-us/azure/cosmos-db/emulator

## Running the Emulator

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

| Setting           | Value                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| Endpoint          | `localhost:8081`                                                                                                   |
| Key               | `C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==`                         |
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

