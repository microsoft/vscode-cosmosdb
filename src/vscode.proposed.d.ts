/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// TODO: Removes after switching to 1.104.*

declare module 'vscode' {
    // https://github.com/microsoft/vscode/issues/260156

    /**********
     * MCP Server API (Proposed)
     * https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.mcpServers.d.ts
     *******/

    /**
     * An MCP server definition.
     */
    export interface McpServerDefinition {
        /**
         * The label of the server, shown in the UI.
         */
        readonly label: string;

        /**
         * Optional version of the server. If this changes, the server will be
         * restarted to pick up the new configuration.
         */
        readonly version?: string;
    }

    /**
     * An MCP server that communicates over HTTP.
     */
    export class McpHttpServerDefinition implements McpServerDefinition {
        /**
         * The label of the server, shown in the UI.
         */
        readonly label: string;

        /**
         * The URI of the HTTP endpoint.
         */
        readonly uri: Uri;

        /**
         * Additional headers to send with requests.
         */
        readonly headers: Record<string, string>;

        /**
         * Optional version of the server.
         */
        readonly version?: string;

        constructor(label: string, uri: Uri, headers?: Record<string, string>, version?: string);
    }

    /**
     * An MCP server that communicates over stdio.
     */
    export class McpStdioServerDefinition implements McpServerDefinition {
        /**
         * The label of the server, shown in the UI.
         */
        readonly label: string;

        /**
         * The command to run.
         */
        readonly command: string;

        /**
         * Arguments to pass to the command.
         */
        readonly args: string[];

        /**
         * Environment variables to set.
         */
        readonly env: Record<string, string | number | null>;

        /**
         * The working directory for the command.
         */
        readonly cwd?: Uri;

        /**
         * Optional version of the server.
         */
        readonly version?: string;

        constructor(
            label: string,
            command: string,
            args?: string[],
            env?: Record<string, string | number | null>,
            version?: string,
        );
    }

    /**
     * A provider that supplies MCP server definitions.
     */
    export interface McpServerDefinitionProvider {
        /**
         * An optional event to signal that the MCP server definitions have changed.
         */
        onDidChangeMcpServerDefinitions?: Event<void>;

        /**
         * Provide the list of MCP server definitions.
         */
        provideMcpServerDefinitions(token: CancellationToken): ProviderResult<McpServerDefinition[]>;

        /**
         * Called when a server definition is about to be used, giving the
         * provider a chance to resolve additional details.
         */
        resolveMcpServerDefinition?(
            server: McpServerDefinition,
            token: CancellationToken,
        ): ProviderResult<McpServerDefinition>;
    }

    export namespace lm {
        /**
         * Register a provider that supplies MCP server definitions.
         * @param id The ID of the provider.
         * @param provider The provider.
         * @returns A disposable that unregisters the provider.
         */
        export function registerMcpServerDefinitionProvider(
            id: string,
            provider: McpServerDefinitionProvider,
        ): Disposable;
    }

    /**********
     * "Extension asking for auth" API
     *******/

    /**
     * Represents parameters for creating a session based on a WWW-Authenticate header value.
     * This is used when an API returns a 401 with a WWW-Authenticate header indicating
     * that additional authentication is required. The details of which will be passed down
     * to the authentication provider to create a session.
     */
    export interface AuthenticationWWWAuthenticateRequest {
        /**
         * The raw WWW-Authenticate header value that triggered this challenge.
         * This will be parsed by the authentication provider to extract the necessary
         * challenge information.
         */
        readonly wwwAuthenticate: string;

        /**
         * @deprecated Use `wwwAuthenticate` instead.
         */
        readonly challenge?: string;

        /**
         * Optional scopes for the session. If not provided, the authentication provider
         * may use default scopes or extract them from the challenge.
         */
        readonly scopes?: readonly string[];
    }

    export namespace authentication {
        /**
         * Get an authentication session matching the desired scopes. Rejects if a provider with providerId is not
         * registered, or if the user does not consent to sharing authentication information with
         * the extension. If there are multiple sessions with the same scopes, the user will be shown a
         * quick pick to select which account they would like to use.
         *
         * Currently, there are only two authentication providers that are contributed from built in extensions
         * to the editor that implement GitHub and Microsoft authentication: their providerId's are 'github' and 'microsoft'.
         * @param providerId The id of the provider to use
         * @param scopeListOrRequest A list of scopes representing the permissions requested. These are dependent on the authentication provider
         * @param options The {@link AuthenticationGetSessionOptions} to use
         * @returns A thenable that resolves to an authentication session
         */
        export function getSession(
            providerId: string,
            scopeListOrRequest: ReadonlyArray<string> | AuthenticationWWWAuthenticateRequest,
            options: AuthenticationGetSessionOptions & {
                /** */ createIfNone: true | AuthenticationGetSessionPresentationOptions;
            },
        ): Thenable<AuthenticationSession>;

        /**
         * Get an authentication session matching the desired scopes. Rejects if a provider with providerId is not
         * registered, or if the user does not consent to sharing authentication information with
         * the extension. If there are multiple sessions with the same scopes, the user will be shown a
         * quick pick to select which account they would like to use.
         *
         * Currently, there are only two authentication providers that are contributed from built in extensions
         * to the editor that implement GitHub and Microsoft authentication: their providerId's are 'github' and 'microsoft'.
         * @param providerId The id of the provider to use
         * @param scopeListOrRequest A list of scopes representing the permissions requested. These are dependent on the authentication provider
         * @param options The {@link AuthenticationGetSessionOptions} to use
         * @returns A thenable that resolves to an authentication session
         */
        export function getSession(
            providerId: string,
            scopeListOrRequest: ReadonlyArray<string> | AuthenticationWWWAuthenticateRequest,
            options: AuthenticationGetSessionOptions & {
                /** literal-type defines return type */ forceNewSession:
                    | true
                    | AuthenticationGetSessionPresentationOptions
                    | AuthenticationForceNewSessionOptions;
            },
        ): Thenable<AuthenticationSession>;

        /**
         * Get an authentication session matching the desired scopes. Rejects if a provider with providerId is not
         * registered, or if the user does not consent to sharing authentication information with
         * the extension. If there are multiple sessions with the same scopes, the user will be shown a
         * quick pick to select which account they would like to use.
         *
         * Currently, there are only two authentication providers that are contributed from built in extensions
         * to the editor that implement GitHub and Microsoft authentication: their providerId's are 'github' and 'microsoft'.
         * @param providerId The id of the provider to use
         * @param scopeListOrRequest A list of scopes representing the permissions requested. These are dependent on the authentication provider
         * @param options The {@link AuthenticationGetSessionOptions} to use
         * @returns A thenable that resolves to an authentication session if available, or undefined if there are no sessions
         */
        export function getSession(
            providerId: string,
            scopeListOrRequest: ReadonlyArray<string> | AuthenticationWWWAuthenticateRequest,
            options?: AuthenticationGetSessionOptions,
        ): Thenable<AuthenticationSession | undefined>;
    }

    /**********
     * "Extension providing auth" API
     * NOTE: This doesn't need to be finalized with the above
     *******/

    /**
     * Represents an authentication challenge from a WWW-Authenticate header.
     * This is used to handle cases where additional authentication steps are required,
     * such as when mandatory multi-factor authentication (MFA) is enforced.
     */
    export interface AuthenticationChallenge {
        /**
         * The authentication scheme (e.g., 'Bearer').
         */
        readonly scheme: string;

        /**
         * Parameters for the authentication challenge.
         * For Bearer challenges, this may include 'claims', 'scope', 'realm', etc.
         */
        readonly params: Record<string, string>;
    }

    /**
     * Represents constraints for authentication, including challenges and optional scopes.
     * This is used when creating or retrieving sessions that must satisfy specific authentication
     * requirements from WWW-Authenticate headers.
     */
    export interface AuthenticationConstraint {
        /**
         * Array of authentication challenges parsed from WWW-Authenticate headers.
         */
        readonly challenges: readonly AuthenticationChallenge[];

        /**
         * Optional scopes for the session. If not provided, the authentication provider
         * may extract scopes from the challenges or use default scopes.
         */
        readonly scopes?: readonly string[];
    }

    /**
     * An authentication provider that supports challenge-based authentication.
     * This extends the base AuthenticationProvider with methods to handle authentication
     * challenges from WWW-Authenticate headers.
     *
     * But this can be done later since this part doesn't need finalization.
     */
    export interface AuthenticationProvider {
        /**
         * Get existing sessions that match the given authentication constraints.
         *
         * @param constraint The authentication constraint containing challenges and optional scopes
         * @param options Options for the session request
         * @returns A thenable that resolves to an array of existing authentication sessions
         */
        getSessionsFromChallenges?(
            constraint: AuthenticationConstraint,
            options: AuthenticationProviderSessionOptions,
        ): Thenable<readonly AuthenticationSession[]>;

        /**
         * Create a new session based on authentication constraints.
         * This is called when no existing session matches the constraint requirements.
         *
         * @param constraint The authentication constraint containing challenges and optional scopes
         * @param options Options for the session creation
         * @returns A thenable that resolves to a new authentication session
         */
        createSessionFromChallenges?(
            constraint: AuthenticationConstraint,
            options: AuthenticationProviderSessionOptions,
        ): Thenable<AuthenticationSession>;
    }

    export interface AuthenticationProviderOptions {
        supportsChallenges?: boolean;
    }
}
