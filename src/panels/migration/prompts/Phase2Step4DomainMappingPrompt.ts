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
 * Props for the Phase2Step4DomainMappingPrompt element.
 */
interface Phase2Step4DomainMappingPromptProps extends BasePromptElementProps {
    domainName: string;
    tables: string[];
    language: string;
    frameworks: string[];
    domainSummary: string;
}

/**
 * Prompt element for determining whether a domain is mapped in application code.
 *
 * After domains have been identified in the assessment step, this prompt is run
 * per domain with tool access (listWorkspaceFiles / readWorkspaceFile) so the AI
 * can inspect the source code and decide whether the domain's tables are actually
 * referenced — via ORM mappings, repository classes, SQL queries, etc.
 */
export class Phase2Step4DomainMappingPrompt extends PromptElement<Phase2Step4DomainMappingPromptProps> {
    render(_state: void, _sizing: PromptSizing): PromptPiece {
        const tableList = this.props.tables.map((t) => `  - ${t}`).join('\n');
        const frameworkHint =
            this.props.frameworks.length > 0 ? `The project uses: ${this.props.frameworks.join(', ')}.` : '';
        const languageHint = this.props.language ? `The primary language is ${this.props.language}.` : '';

        return vscpp(
            vscppf,
            null,
            vscpp(
                UserMessage,
                { priority: 200 },
                vscpp(
                    TextChunk,
                    null,
                    `You are a code analysis expert. Your ONLY task is to determine whether the database domain
"${this.props.domainName}" is mapped (i.e. actively referenced) in application source code.

${languageHint} ${frameworkHint}

The domain contains these database tables:
${tableList}
${
    this.props.domainSummary
        ? `
KNOWN MAPPINGS FROM DISCOVERY:
The following code references were already found during the discovery phase.
If they exist, the domain is very likely mapped — verify at least one of these
files still exists and references the tables before concluding.

${this.props.domainSummary}
`
        : ''
}
Use the provided tools to search for evidence that any of these tables are used in the
application code. Look for:
- ORM entity/model classes or mappings (e.g. EF Core DbSet, Hibernate @Entity, Sequelize models)
- Repository or data-access classes that reference these tables
- Raw SQL queries, stored procedure calls, or query builders mentioning these table names
- API controllers, services, or handlers that operate on data from these tables
- Migration files or schema definitions that reference these tables

Strategy:
1. If known mappings are listed above, start by reading those files to confirm
   they reference the domain's tables. A single confirmed reference is sufficient.
2. If no known mappings exist, or they could not be confirmed, call listWorkspaceFiles
   with patterns targeting data-layer code
   (e.g. "**/*Model*", "**/*Repository*", "**/*Entity*", "**/*Context*", "**/*.sql").
3. Also search for files by table name patterns (e.g. "**/*${this.props.tables[0]}*").
4. Read promising files to confirm actual references to the table names.
5. You do NOT need to find every reference — a single confirmed reference to any table
   in the domain is enough to mark it as mapped.

After your investigation, respond with ONLY a JSON object in this format:
{
  "isMapped": true | false,
  "evidence": "Brief explanation of what you found or why no mapping was detected"
}

IMPORTANT:
- Respond ONLY with the JSON object after you have finished your investigation.
- Do not wrap it in a code block.
- If you find at least one clear reference to any table in this domain, set isMapped to true.
- If no references are found after a thorough search, set isMapped to false.`,
                ),
            ),
        );
    }
}
