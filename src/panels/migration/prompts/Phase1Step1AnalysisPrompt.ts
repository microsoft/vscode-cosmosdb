/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type BasePromptElementProps,
    PromptElement,
    type PromptPiece,
    type PromptSizing,
    TextChunk,
    UserMessage,
} from '@vscode/prompt-tsx';

// vscpp and vscppf are set on globalThis by @vscode/prompt-tsx when imported
declare const vscpp: (ctor: unknown, props: unknown, ...children: unknown[]) => PromptPiece;
declare const vscppf: { isFragment: boolean };

/**
 * Props for the MigrationAnalysisPrompt element.
 */
interface Phase1Step1AnalysisPromptProps extends BasePromptElementProps {
    schemaContext: string;
    schemaFileTypes: string[];
    workspaceContext: string;
}

/**
 * Prompt element for the migration application analysis step.
 *
 * Uses @vscode/prompt-tsx to manage token budgets and structure the prompt
 * with prioritized sections. The system message and output format have the
 * highest priority, while schema file content is truncated if it exceeds
 * the token budget.
 */
export class Phase1Step1AnalysisPrompt extends PromptElement<Phase1Step1AnalysisPromptProps> {
    render(_state: void, _sizing: PromptSizing): PromptPiece {
        const schemaTypes = this.props.schemaFileTypes.join(', ') || 'unknown';

        // Note: VS Code's LanguageModelChatMessageRole only supports User and Assistant.
        // @vscode/prompt-tsx's SystemMessage uses ChatRole.System which is not handled
        // by the VS Code output converter, causing token counting to fail.
        // We use UserMessage for all messages instead.
        return vscpp(
            vscppf,
            null,
            vscpp(
                UserMessage,
                { priority: 200 },
                vscpp(
                    TextChunk,
                    null,
                    `You are a database migration assistant specializing in migrating relational databases to Azure Cosmos DB NoSQL.
You are analyzing a software project's source code workspace to understand the APPLICATION that uses a database.

Extract the following information:

APPLICATION-LEVEL fields (about the codebase, NOT the database):
1. "projectName" - The name of the application/project (from project manifests like .csproj, package.json, pom.xml, etc.)
2. "projectType" - The type of the APPLICATION (e.g. "Web App", "REST API", "Microservice", "Console App", "Desktop App", "Mobile App"). This is NOT "Database" — every project here uses a database, we want to know what KIND of application it is.
3. "language" - The primary PROGRAMMING language of the application source code (e.g. "C#", "Java", "TypeScript", "Python"). This is NOT "SQL" — SQL is a query language used by the database, not the application language.
4. "frameworks" - Application frameworks used (e.g. ["ASP.NET Core", "Entity Framework Core"], ["Spring Boot", "Hibernate"], ["Express.js", "Sequelize"])

DATABASE-LEVEL fields (about the database the application connects to):
5. "databaseType" - The source database system (e.g. "PostgreSQL", "MySQL", "SQL Server", "Oracle")
6. "databaseAccess" - How the application accesses the database (e.g. "Entity Framework Core", "Hibernate", "raw SQL", "stored procedures", "Dapper")

The database schema files provided are of type: ${schemaTypes}

Respond ONLY with a JSON object in this exact format:
{
  "projectName": "string",
  "projectType": "string",
  "language": "string",
  "frameworks": ["string"],
  "databaseType": "string",
  "databaseAccess": "string"
}`,
                ),
            ),
            vscpp(
                UserMessage,
                { priority: 100 },
                vscpp(
                    TextChunk,
                    { priority: 95 },
                    'Analyze this workspace for database migration.\n\nWorkspace Project Files (use these to determine the APPLICATION type, language, and frameworks):\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 85, breakOnWhitespace: true },
                    this.props.workspaceContext || '(no workspace project files found)',
                ),
                vscpp(
                    TextChunk,
                    { priority: 90 },
                    '\n\nDatabase Schema Files (use these to determine the DATABASE type and access method):\n',
                ),
                vscpp(
                    TextChunk,
                    { priority: 50, breakOnWhitespace: true },
                    this.props.schemaContext || '(no schema files provided)',
                ),
                vscpp(
                    TextChunk,
                    { priority: 80 },
                    '\n\nPlease analyze the workspace and provide the project metadata as JSON.',
                ),
            ),
        );
    }
}
