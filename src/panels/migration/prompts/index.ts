/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { ApplicationDetailsPrompt } from './ApplicationDetailsPrompt';
export { buildCodeMigrationPrompt } from './CodeMigrationPrompt';
export { buildAnalyzeAccessPatternsPrompt, buildAnalyzeVolumetricsPrompt } from './Phase1Step1AnalysisPrompts';
export { buildChatDiscoveryPrompt } from './Phase1Step2ChatDiscoveryPrompt';
export { Phase1Step2DiscoveryPrompt } from './Phase1Step2DiscoveryPrompt';
export { Phase2Step0AccessPatternExtractionPrompt } from './Phase2Step0AccessPatternExtractionPrompt';
export { Phase2Step1AssessmentPrompt } from './Phase2Step1AssessmentPrompt';
export { Phase2Step2SplitDomainPrompt } from './Phase2Step2SplitDomainPrompt';
export { Phase2Step3CrossDomainPrompt } from './Phase2Step3CrossDomainPrompt';
export { Phase2Step4DomainMappingPrompt } from './Phase2Step4DomainMappingPrompt';
export { Phase2Step5SummaryPrompt } from './Phase2Step5SummaryPrompt';
export { Phase3FastConversionPrompt } from './Phase3FastConversionPrompt';
export { Phase3Step1ContainerDesignPrompt } from './Phase3Step1ContainerDesignPrompt';
export { Phase3Step2PartitionKeyPrompt } from './Phase3Step2PartitionKeyPrompt';
export { Phase3Step3EmbeddingPrompt } from './Phase3Step3EmbeddingPrompt';
export { Phase3Step4AccessPatternsPrompt } from './Phase3Step4AccessPatternsPrompt';
export { Phase3Step5CrossPartitionPrompt } from './Phase3Step5CrossPartitionPrompt';
export { Phase3Step6IndexingPrompt } from './Phase3Step6IndexingPrompt';
export { Phase3Step7SummaryPrompt } from './Phase3Step7SummaryPrompt';
export { Phase3Step8FinalSummaryPrompt } from './Phase3Step8FinalSummaryPrompt';
export { Phase4SampleDataPrompt } from './Phase4SampleDataPrompt';
