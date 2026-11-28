# Recommended Tools and Capabilities

Select tools for the current phase and target, not for the entire migration upfront.
Required capabilities may have more than one implementation. Reuse suitable installed
tools and authenticated connections; do not install every tool in this reference.
The Skill remains independent of the agent harness and does not require an MCP server.

## Phase-Scoped Tooling

| Tool or capability | When needed | Recommendation |
| --- | --- | --- |
| File, search, edit, and command execution | Reading application evidence and running local helpers | Use the host's ordinary tools, scoped to the selected application root. |
| [Node.js](https://nodejs.org/en/download) | Bundled migration helpers | A supported Node.js runtime; helper requirements and side effects are in [Helper Commands](./helper-commands.md). |
| Python and SQLGlot | Only when SQLGlot DDL interpretation is selected | Follow [DDL Interpretation](../workflow/ddl-interpretation.md) and its selected-parser setup. Model-only interpretation needs neither dependency. |
| Bicep compilation | Compiling Azure deployment templates and parameters | Azure CLI's managed Bicep compiler or the standalone Microsoft Bicep CLI; both are not required. See [Provisioning](#provisioning). |
| Authenticated Azure management access | Azure account inspection, what-if, deployment, and control-plane readback | Azure CLI is a recommended route; supported Azure SDK, REST, or Microsoft Azure MCP capabilities are alternatives. |
| Cosmos DB Shell | Executing generated sample-data seed scripts | Use a compatible Shell under the [Shell contract](../phases/provisioning.md#seed-script-shell-contract), including its minimum version and capability checks. |
| Cosmos DB SDK | Resource or item operations when the selected tool cannot provide the required behavior or evidence | Use a supported Microsoft SDK with the chosen language/runtime and authentication support; exact point reads must support the full typed partition key. |
| Application build and test toolchain | Executing and verifying application code migration | Use the application's existing language SDK, package manager, and test runner; follow [Code Migration](../phases/code-migration.md). |
| Cosmos DB emulator and its hosting runtime | Only when the emulator is the selected target | Use the chosen emulator's supported installation; a container runtime is needed only for a container-hosted emulator. |
| .NET runtime or SDK | Only for a chosen .NET-based tool, SDK verifier, or application | Follow that component's setup requirements. Do not require .NET for unrelated source analysis or model design. |

Source analysis and local artifact generation do not require Azure credentials.
Generating Bicep text with the bundled helper needs Node.js, not an installed Bicep
compiler; compilation and deployment are separate operations. Azure Developer CLI
(`azd`) is relevant only when the selected project already uses that workflow or the
user requests it. Do not introduce an azd project merely to run this migration.

## Provisioning

Microsoft's [Bicep compiler](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/bicep-cli)
translates Bicep definitions into ARM template JSON and resolves Bicep parameter files
into JSON deployment parameters. Azure CLI invokes the same Bicep toolchain and normally
manages its own compiler installation, separate from a standalone executable on PATH.
A missing standalone Bicep command does not mean Azure CLI's compiler is unavailable.
Check the version and capabilities of the route actually selected; separate installations
can have different versions. See [Install Bicep tools](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/install).

Compilation is not deployment. Choose an authenticated management-plane route that can
preview and submit the generated template and its parameters without reconstructing the
resource definitions. A compiler-backed tool can supply the inputs if it exposes complete
deployable template and parameter outputs, not just diagnostics or a predicted-resource
snapshot. The [provisioning workflow](../phases/provisioning.md) owns authorization,
resource scope, artifact generation, seeding, and verification regardless of transport.

For Azure management, prefer an available supported route such as
[Azure CLI](https://learn.microsoft.com/en-us/cli/azure/), the
[Azure SDKs](https://azure.microsoft.com/en-us/downloads/), or the
[Microsoft Azure MCP Server](https://learn.microsoft.com/en-us/azure/developer/azure-mcp-server/overview).
Verify its actual capabilities and intended tenant/subscription context before use.
Authentication working in one tool does not prove that another tool's credentials or
permissions work. Do not change the selected account or weaken authentication to work
around a tool-specific login failure.

For sample-data execution, distinguish the generated Shell route from a supported
SDK or tool workaround. Follow the [Shell contract](../phases/provisioning.md#seed-script-shell-contract)
and record any execution adjustment in the existing summary. A workaround must preserve
the target, synthetic fixture, idempotency, and required resource and point-read evidence.

## Optional Microsoft Bicep MCP

Recommend Microsoft's [Bicep MCP server](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/bicep-mcp-server)
when the host supports MCP and Bicep authoring or diagnostics would benefit from it.
It supplies first-party best-practice guidance, resource schemas, diagnostics, formatting,
and other Bicep tooling. It can run with multiple MCP-compatible harnesses; no editor
or extension UI is required. Reuse an available server and inspect its advertised tools
rather than assuming every version exposes the same capabilities.

Bicep MCP is optional, not a required peer Skill or an Azure deployment service.
Its deployment snapshots are local predictions, not live Azure what-if results or
deployable ARM templates. A snapshot or successful diagnostic check does not replace
compiler output, authenticated deployment, or live resource verification. If the server
is unavailable, use suitable compiler tooling and the official
[Bicep documentation](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/).
No third-party Bicep skill is required or recommended.

## Availability and Installation

Check only the capabilities needed for the requested operation, using read-only version,
help, or capability inspection before relying on a tool. Follow the owning phase's
minimum versions and command contracts; do not invent a universal minimum or upgrade
a working installation solely because a newer release exists.

Explain proposed installations, upgrades, downloads, and environment changes, and obtain
approval under the host's execution and network controls. Some tools automatically
download compilers, restore modules, or acquire packages on first use; account for those
side effects before invoking them. Provisioning permission does not imply installation
permission. Prefer official Microsoft/Azure documentation and distributions for Azure
tooling and optional agent integrations; use the existing SQLGlot selection rules for
that optional parser.

If a needed capability is missing, offer a supported alternative or approved setup and
follow [Blocker Resolution](../workflow/interaction-and-checkpoints.md#blocker-resolution).
Do not block an unrelated phase because an optional tool is absent, install an unused
toolchain, or add a new readiness artifact merely to track these checks.