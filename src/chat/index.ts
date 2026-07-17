/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { CosmosDbChatParticipant, type PendingEditQueryResult } from './cosmosDbChatParticipant';
export {
    CosmosDbOperationsService,
    QueryGenerationRefusedError,
    type QueryExecutionEntry,
    type QueryHistoryContext,
} from './CosmosDbOperationsService';
export { OperationParser } from './OperationParser';

// System prompts (fixed, versioned instructions)
export * from './systemPrompt';

// User payload types and builders (dynamic user content)
export * from './userPayload';

// Language model tools
export { APPLY_QUERY_TO_EDITOR_TOOL_NAME, registerApplyQueryToEditorTool } from './applyQueryToEditorTool';
export { EXECUTE_CURRENT_QUERY_TOOL_NAME, registerExecuteCurrentQueryTool } from './executeCurrentQueryTool';
export { GET_QUERY_EDITOR_CONTEXT_TOOL_NAME, registerGetQueryEditorContextTool } from './getQueryEditorContextTool';
export { registerSampleDataTool, SAMPLE_DATA_TOOL_NAME } from './sampleDataTool';
