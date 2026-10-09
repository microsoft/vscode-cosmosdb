# RFC: Azure Cosmos DB Emulator local experience

- Status: Proposed
- Date: 2026-08-19
- Owners: Azure Cosmos DB VS Code extension team
- Tracking issue: [#3285](https://github.com/microsoft/vscode-cosmosdb/issues/3285)

## Summary

Add a guided local-development experience that can provision, connect, and manage the Azure Cosmos DB Linux
Emulator from the VS Code extension. The experience starts in the existing **Local Emulators** tree, uses Docker for
the emulator lifecycle, proves readiness with the Azure Cosmos DB SDK, securely saves the connection, and returns the
user to the tree to browse databases and containers.

This RFC adapts the shipped DocumentDB Local workflow to the Azure Cosmos DB Emulator. The reusable parts are the
wizard structure, Docker diagnosis, provisioning state machine, ownership rules, rollback, reconciliation, and tree
integration. The image contract, fixed emulator credentials, TLS handling, readiness probe, and Cosmos DB tree model
are specific to this extension.

## Motivation

The extension can already attach to a running emulator, but users must install or start it separately, know its
connection details, and diagnose Docker, port, TLS, and startup failures themselves. This creates a gap between
choosing local development and reaching a browsable Cosmos DB account.

The repository already proves the core technical contract in its Docker-based end-to-end test harness:

- the Linux `vnext-preview` image runs on all currently supported desktop platforms;
- the emulator can persist data across restarts;
- a scoped TLS agent can connect without disabling certificate validation process-wide;
- endpoint discovery must be disabled for host port mappings; and
- `CosmosClient.getDatabaseAccount()` is a reliable service-level readiness probe.

The proposed experience productizes those capabilities without changing the existing manual attach flow.

## Goals

1. Let a user install and start a local Azure Cosmos DB for NoSQL emulator from the **Local Emulators** tree.
2. Diagnose Docker availability and common failures with actionable, platform-specific guidance.
3. Persist emulator data across container recreation unless the user explicitly chooses to erase it.
4. Save a ready emulator as a standard browsable local connection using the existing secure storage path.
5. Expose Start, Stop, Restart, logs, reconnect, and Delete actions in the tree.
6. Reconcile extension state with Docker after reloads, crashes, and out-of-band container changes.
7. Never stop, delete, or adopt a container unless extension ownership is proven by labels.
8. Preserve the existing **New Emulator Connection...** flow for emulators managed outside the extension.

## Non-goals

- Managing cloud Cosmos DB accounts or replacing the Azure account connection flow.
- Supporting production workloads or promising full cloud-service feature parity.
- Installing Docker, changing Docker permissions, or running elevated recovery commands for the user.
- Managing arbitrary user-created emulator containers.
- Supporting APIs other than Azure Cosmos DB for NoSQL in the first release.
- Building a general-purpose Docker user interface.
- Hiding the emulator's fixed development key or presenting it as a production-grade secret.
- Automatically migrating data from another emulator installation or container.

## Existing experience

The current **Local Emulators** node reads saved emulator connections from `AttachedAccounts`. Its
**New Emulator Connection...** command asks for a preconfigured endpoint or custom connection string and stores the
connection string through `StorageService`, whose secret values use VS Code `SecretStorage`.

The new experience extends this model:

```text
Local Emulators
  Set up Azure Cosmos DB Emulator       Not set up
  New Emulator Connection...            Existing manual attach path
```

After successful setup:

```text
Local Emulators
  Azure Cosmos DB Emulator              Running
    database
      container
  New Emulator Connection...
```

Manually attached emulator connections remain ordinary saved connections. Only the dedicated managed-emulator row
receives Docker lifecycle actions.

## User experience

### Entry points

- A **Set up Azure Cosmos DB Emulator** row appears under **Local Emulators** when no managed instance exists.
- The command palette exposes **Cosmos DB: Set Up Local Emulator**.
- Existing managed instances open in recovery or status mode instead of silently being recreated.
- **New Emulator Connection...** remains available for Windows Emulator, custom ports, remote Docker hosts, and
  containers managed outside the extension.

### Wizard

The panel title is **Azure Cosmos DB Emulator** and has four steps: **Introduction**, **Configure**, **Set up**, and
**Done**.

#### Introduction

The page explains that the emulator is for local development and testing, requires Docker, uses a fixed development
key and a self-signed certificate, persists data locally, and does not match every cloud capability. Nothing is pulled
or created before the user continues from Configure.

#### Configure

The defaults should work without editing:

| Setting        | Default                            | Requirement                                                         |
| -------------- | ---------------------------------- | ------------------------------------------------------------------- |
| Address        | `localhost:8081`                   | Main endpoint host port must be available and explicitly confirmed. |
| Auxiliary port | `1234`                             | Must be available; it is not presented as a connection endpoint.    |
| Image          | Approved `vnext-preview` reference | Repository is fixed; an approved tag may be selected.               |
| Data           | Preserve between restarts          | Uses an extension-owned named volume.                               |
| Sample data    | Off                                | Optional, deterministic, cancellable, and idempotent when enabled.  |

Advanced settings may allow alternative host ports, but setup never silently relocates a requested port. Both ports
are published to `127.0.0.1` only.

Starting setup clearly states that Docker will pull an image, create one labelled container and extension-owned
volumes, and save a local connection after readiness succeeds.

#### Set up

The setup page retains a progress checklist throughout success and failure:

1. Checking Docker
2. Checking ports
3. Pulling emulator image
4. Preparing persistent storage
5. Creating container
6. Starting container
7. Waiting for Azure Cosmos DB to accept connections
8. Adding sample data, when selected
9. Saving connection

The Docker row includes the detected provider, endpoint kind, daemon state, architecture, and check time. A setup log
is available from the page, with credentials and connection strings masked.

Cancellation is cooperative. It stops the active command or readiness loop and cleans up only resources created by
the current attempt, subject to the rollback rules below.

#### Done

The page confirms the endpoint and saved connection name. **Open Connection** closes the panel, reveals the managed
emulator in the tree, and expands it. **Close** leaves the ready connection in the tree.

### Failure layout

A failed stage remains visible and marked in the checklist. A message bar below the checklist contains the diagnosis,
recovery guidance, and controls that act on that failure. The footer contains only run-level actions such as Back,
Retry setup, Start over, or Wait longer.

Every failure must preserve a path forward. An indeterminate Docker diagnosis may offer **Continue anyway**. The
extension displays copyable recovery commands but never runs commands requiring elevation.

For a readiness timeout, the container remains running and the user can:

- **Wait longer**, which resumes only the SDK readiness probe; or
- **Start over**, which explains whether the selected action preserves or erases data.

## Functional requirements

### Provisioning

- **FR-1:** Setup must validate Docker readiness and both requested host ports before pulling an image.
- **FR-2:** Setup must acquire a durable provisioning lease before creating Docker resources.
- **FR-3:** The service must emit semantic, ordered stage events and support cancellation through `AbortSignal`.
- **FR-4:** Container creation must use the approved image contract and bind published ports to loopback only.
- **FR-5:** Data must survive stop, start, restart, and non-destructive container recreation.
- **FR-6:** Readiness must use a real Cosmos DB SDK data-plane call rather than container state or an HTTP certificate
  endpoint.
- **FR-7:** The saved connection must not be finalized as Running until readiness succeeds.
- **FR-8:** Concurrent setup attempts for the managed instance must be rejected or joined without creating duplicate
  resources.
- **FR-9:** Optional sample data must be imported only after readiness and must report its own stage and errors.

### Ownership and cleanup

- **FR-10:** Managed containers and volumes must carry extension ownership labels and an operation identifier.
- **FR-11:** Destructive lifecycle operations must require matching ownership labels; name, image, and port are not
  sufficient evidence.
- **FR-12:** On failure or cancellation before readiness, rollback removes only the container created by the current
  operation and restores overwritten durable state.
- **FR-13:** A readiness timeout preserves the running container, volume, and state needed by **Wait longer**.
- **FR-14:** Deleting the managed emulator requires explicit confirmation and separately states whether data volumes
  will be preserved or erased.
- **FR-15:** A name or port collision with an unowned container must never be resolved by modifying that container.

### Persistence and reconciliation

- **FR-16:** Durable state must record a stable managed-instance ID, selected image reference, host ports, volume IDs,
  container ID when known, lifecycle state, and provisioning lease.
- **FR-17:** Connection strings remain in VS Code `SecretStorage`; durable metadata contains no key or connection
  string.
- **FR-18:** Activation and tree refresh must reconcile durable records against labelled Docker resources.
- **FR-19:** Reconciliation must represent missing containers, stopped containers, unavailable Docker, incomplete
  provisioning, and missing secret state without discarding recoverable data.
- **FR-20:** Existing manually attached emulator records must not be adopted or changed by reconciliation.

### Tree lifecycle

- **FR-21:** A Running managed instance must reuse the existing browsable NoSQL account tree behavior.
- **FR-22:** Non-running states must render status rows with valid actions instead of attempting SDK expansion.
- **FR-23:** Before expansion, the node must preflight live container state so infrastructure failures do not become
  long SDK timeouts.
- **FR-24:** Start, Stop, Restart, View setup log, Reconnect, and Delete actions must refresh affected tree state.
- **FR-25:** Reveal and reverse lookup must use stable connection identity independently from the current tree path.

## Image contract

The implementation must begin with an automated spike that verifies the currently approved image. Values below
reflect the contract already used in this repository and must be revalidated before implementation.

| Property                 | Proposed value                                                                |
| ------------------------ | ----------------------------------------------------------------------------- |
| Repository               | `mcr.microsoft.com/cosmosdb/linux/azure-cosmos-emulator`                      |
| Initial tag              | `vnext-preview`                                                               |
| Main container port      | `8081`                                                                        |
| Auxiliary container port | `1234`                                                                        |
| Protocol                 | `PROTOCOL=https-insecure`                                                     |
| Data path                | `/usr/cosmos/data`                                                            |
| Log path                 | `/logs`                                                                       |
| Socket path              | `/socket` as an empty `tmpfs` mount                                           |
| Process user             | Image user, currently UID/GID `1000`; validate rather than assume permanently |
| Authentication           | Emulator well-known key                                                       |
| Persistence              | Extension-owned named volumes for data and logs                               |
| Readiness                | `CosmosClient.getDatabaseAccount()`                                           |

The spike must prove pull, loopback-bound run, first-start permissions, readiness, create/read persistence across
restart and recreation, logs, stop, and delete on every supported host architecture. Image tags must not be updated
automatically without compatibility validation.

## Architecture

```text
React setup wizard
  | typed queries, mutations, progress subscription, AbortSignal
  v
tRPC router and webview panel controller
  | validated inputs and secret-free status DTOs
  v
Local emulator setup and lifecycle service
  | provisioning state machine, lease, ownership, rollback, persistence
  v
Container runtime adapter
  | typed Docker commands, output capture, cancellation
  v
Docker CLI and daemon

On readiness:

  SecretStorage + managed-instance registry
                  |
                  v
  Local Emulators tree -> existing NoSQL account browsing
```

The router must not execute Docker commands. The webview must not infer lifecycle state or decide cleanup. Those
decisions belong to a host-side service behind a narrow `IContainerRuntime` interface.

Use the repository's `@cosmosdb/webview-rpc` package for tRPC transport, subscriptions, cancellation, and middleware.
Evaluate the shared `@microsoft/vscode-ext-webview-fluentui` package for wizard chrome and VS Code-aware Fluent UI
theming when its required components are available; this does not block the image-contract and service work.

Use `@microsoft/vscode-container-client` for typed Docker commands and `@microsoft/vscode-processutils` for execution
if their released APIs satisfy evidence capture and cancellation requirements. Any temporary failed-command capture
compatibility layer must be narrow and tested so it can be replaced by an upstream API.

### Proposed state model

```text
notConfigured
  -> checkingDocker
  -> checkingPorts
  -> pulling
  -> preparingStorage
  -> creating
  -> starting
  -> waiting
  -> seeding (optional)
  -> saving
  -> running

running <-> stopping <-> stopped <-> starting
any transitional state -> recoverableError
waiting -> readinessTimedOut -> waiting | deleting | notConfigured
```

State transitions are serialized per managed-instance ID. The service is authoritative; UI state is a projection of
service events and durable records.

## Cosmos DB client requirements

The readiness client and browsable saved connection must:

- use Gateway mode where the SDK exposes that choice;
- set `enableEndpointDiscovery: false` because the container may advertise its internal endpoint;
- use the requested host endpoint, normally `https://localhost:8081`;
- accept the emulator's self-signed certificate only through a client-scoped HTTPS agent; and
- reuse a client within a readiness attempt rather than creating one for every poll.

The implementation must never set `NODE_TLS_REJECT_UNAUTHORIZED=0` for the extension host process. Emulator TLS
relaxation must not affect Azure, marketplace, telemetry, or other HTTPS requests.

## Docker readiness and diagnosis

The readiness engine captures structured evidence before classifying a result:

- executable discovery and spawn errors;
- Docker client and daemon responses;
- active context and endpoint source;
- local, WSL, remote, or containerized extension host;
- provider when identifiable, such as Docker Desktop, Docker Engine, Rancher Desktop, or Podman compatibility;
- daemon OS and architecture;
- exit code, cancellation, deadline, duration, stdout, and stderr; and
- whether Linux socket access was denied.

At minimum, diagnoses distinguish Docker not installed, daemon unavailable, access denied, unsupported architecture,
invalid context, remote endpoint failure, port conflict, image pull failure, storage permission failure, container exit,
readiness timeout, cancellation, and indeterminate failure.

Providers explain failures and return structured recovery actions. They do not display UI, execute recovery, or make
rollback decisions.

## Security and privacy

- Publish emulator ports on `127.0.0.1`, not every network interface.
- Store the connection string using the existing `StorageService` secret path.
- Do not put credentials or connection strings in command arguments, logs, durable metadata, tRPC DTOs, errors, or
  telemetry.
- Mask the well-known emulator key even though it is public and fixed, so secret-handling behavior remains uniform.
- Never disable TLS verification globally.
- Never execute elevated commands or modify Docker groups, sockets, contexts, or daemon settings.
- Gate every destructive Docker action on ownership labels.
- Treat image reference overrides as an advanced, validated option; do not accept arbitrary command fragments.

## Accessibility and localization

- All user-facing strings use `l10n.t()` and remain within extraction limits.
- The wizard uses semantic headings, labelled controls, keyboard-accessible actions, and visible focus.
- Stage changes and failures are announced through a polite live region without repeating the full checklist.
- Focus moves to the failure summary after a stage fails and returns predictably after Retry or Back.
- Progress is not communicated by color or icon alone.
- Copy controls expose accessible names and confirmation announcements.
- Responsive breadcrumbs retain the current step name at narrow widths.

Implementation of the React/Fluent UI surface must follow the repository accessibility skill and include automated
axe-style checks plus keyboard and screen-reader-oriented component tests.

## Telemetry

Telemetry answers whether the feature works without identifying users or their resources. Proposed events cover:

- wizard opened, cancelled, completed, or failed;
- Docker readiness outcome and classified reason;
- provisioning stage outcome and duration;
- lifecycle command outcome and duration;
- reconciliation outcome; and
- optional sample-data selection and outcome.

Allowed dimensions include normalized platform, architecture, Docker provider category, endpoint kind, stage,
classification, cancellation, and whether defaults were used. Measurements include durations and retry counts.

Do not emit endpoint values, ports, paths, container or volume names/IDs, Docker contexts, image overrides, database or
container names, connection strings, keys, command output, or raw error messages. Telemetry implementation must follow
the repository telemetry skill.

## Testing strategy

### Unit tests

- provisioning stage order, cancellation, retries, and event payloads;
- operation lease acquisition and concurrent setup rejection;
- ownership-label checks for every destructive operation;
- rollback at each stage, including state and secret restoration;
- readiness timeout preservation and **Wait longer** resumption;
- Docker evidence classification with Windows, macOS, Linux, WSL, remote, and indeterminate fixtures;
- masking across logs, DTOs, errors, and telemetry;
- durable-state reconciliation for every lifecycle state; and
- stable identity and tree reveal round trips.

### Component tests

- four-step navigation and Configure validation;
- progress subscription and cancellation;
- checklist-preserving failure layout;
- focus management, live-region announcements, keyboard operation, and responsive breadcrumbs; and
- destructive confirmation copy for preserve-data and erase-data choices.

### Integration and end-to-end tests

- provision the approved image from a clean Docker environment;
- verify loopback-only bindings and ownership labels;
- connect through the real Cosmos SDK and browse the resulting tree;
- create data, restart and recreate the container, and verify persistence;
- stop, start, restart, inspect logs, reconnect, and delete;
- reload VS Code during provisioning and reconcile on activation;
- remove or stop the container out of band and verify tree recovery actions;
- create an unowned colliding container and prove the extension does not modify it; and
- exercise readiness timeout and resumed waiting without repulling or recreating.

The existing E2E emulator remains isolated on its own Compose project and ports. Product tests must not stop or mutate a
developer's unrelated emulator.

## Rollout

1. Validate and document the image contract in a thin automated spike.
2. Implement and unit-test the container runtime adapter and Docker diagnosis.
3. Implement the lifecycle service, leases, rollback, durable records, and reconciliation behind a feature flag.
4. Add tree states and lifecycle commands while retaining manual attach.
5. Add the tRPC router and accessible wizard.
6. Add integration and end-to-end coverage, then enable for extension insiders/preview users.
7. Review failure telemetry and support feedback before enabling by default.

## Acceptance criteria

- A user with a working supported Docker installation can go from **Local Emulators** to a browsable NoSQL emulator
  without manually entering a key or connection string.
- Cold setup, warm setup, cancellation, and retry communicate accurate stage state.
- Data survives Stop, Restart, VS Code reload, and non-destructive Recreate.
- The extension never changes an unlabelled or differently labelled container or volume.
- Docker and emulator failures provide an actionable next step and access to a masked setup log.
- Readiness is established through the Cosmos SDK with scoped TLS handling and endpoint discovery disabled.
- Manually attached emulator connections continue to work and remain unmanaged.
- All lifecycle actions reconcile the tree without requiring a VS Code reload.
- Accessibility, localization, telemetry privacy, unit, integration, and E2E checks pass.

## Risks and mitigations

| Risk                                               | Mitigation                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Preview image contract changes                     | Pin approved tags, run the contract suite before updates, and surface supported versions.  |
| First startup is slow                              | Show elapsed time, retain detailed stages, and make readiness timeout resumable.           |
| Docker environments vary                           | Capture evidence before classification and allow Continue anyway for indeterminate checks. |
| Persistent storage permissions differ by host      | Validate the init strategy per platform and keep storage preparation explicit.             |
| Self-signed TLS handling leaks globally            | Require a scoped agent and test that process-wide TLS settings are unchanged.              |
| Existing emulator occupies default ports           | Detect before pull and offer explicit alternative host ports without touching the owner.   |
| Tree state drifts after out-of-band Docker changes | Reconcile on activation, refresh, expansion, and lifecycle commands.                       |
| The experience is mistaken for cloud parity        | Repeat the local development purpose and link to documented emulator limitations.          |

## Open questions

1. Should the first release support one extension-managed emulator or multiple alias-keyed managed instances? This RFC
   recommends one managed instance while preserving unlimited manual attachments.
2. Should image tag selection be visible in Configure or hidden behind a setting controlled by the extension team?
3. Should sample data reuse the repository seed catalogue, use a smaller product sample, or be deferred from MVP?
4. Should Delete default to preserving volumes, with a separate **Delete and erase data** action?
5. Which minimum Docker and Compose-compatible providers will be officially supported versus best effort?
6. Is the shared `@microsoft/vscode-ext-webview-fluentui` wizard surface ready for adoption when implementation begins?
7. Should a managed emulator connection be stored in workspace scope, global scope, or offered as a user choice?

## Alternatives considered

### Keep only the manual attach flow

This has the smallest implementation cost but leaves installation, lifecycle, readiness, and failure diagnosis outside
the product. It does not meet the goal of a coherent local-development path.

### Run Docker Compose directly from the wizard

Compose is useful for repository tests but is not a sufficient product boundary. It does not provide the typed
ownership, evidence, cancellation, rollback, and reconciliation contracts required by the extension.

### Adopt containers by name, image, or port

Rejected because those signals do not prove ownership. Adoption could cause the extension to stop or delete user data.

### Treat a running container as ready

Rejected because the emulator can remain alive while its data plane is still initializing or unavailable. A real SDK
request is the only accepted readiness signal.
