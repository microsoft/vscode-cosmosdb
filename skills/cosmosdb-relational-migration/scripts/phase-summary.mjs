// Purpose: Parse and validate migration phase summaries and their referenced evidence.

import fs from 'node:fs';

export function markdownSections(markdown) {
    const sections = new Map();
    let current;
    let fence;
    for (const line of markdown.split(/\r?\n/u)) {
        const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
        if (marker) {
            if (!fence) fence = marker;
            else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
        }
        const heading = !fence && line.match(/^##\s+(.+?)\s*$/u)?.[1];
        if (heading) {
            if (sections.has(heading)) throw new Error(`Duplicate section: ${heading}`);
            current = heading;
            sections.set(current, []);
        } else if (current) sections.get(current).push(line);
    }
    if (fence) throw new Error('Unclosed Markdown fence');
    return new Map([...sections].map(([heading, lines]) => [heading, lines.join('\n').trim()]));
}

export function validateSummary(markdown, requiredSections = []) {
    if (!/^#\s+\S/mu.test(markdown)) throw new Error('Report requires a top-level heading');
    const sections = markdownSections(markdown);
    for (const section of requiredSections) if (!sections.get(section)) throw new Error(`Missing or empty report section: ${section}`);
}

export function readJsonObject(filePath, description = 'Manifest') {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${description} must contain an object`);
    return value;
}

export function assertNoTerminalIssues(issues) {
    if (!Array.isArray(issues)) throw new Error('blockingIssues must be an array');
    const terminalKinds = new Set(['invalid-model', 'data-loss', 'unsupported-behavior', 'failed-validation']);
    for (const [index, issue] of issues.entries()) {
        const location = `blockingIssues[${index}]`;
        if (typeof issue === 'string') {
            throw new Error(`${location} is unclassified; reclassify it as a design-decision or an evidenced correctness failure`);
        }
        if (!issue || typeof issue !== 'object' || Array.isArray(issue) || typeof issue.message !== 'string' || !issue.message.trim()) {
            throw new Error(`${location} must be an issue object with a non-empty message`);
        }
        if (issue.kind === 'design-decision') continue;
        if (!terminalKinds.has(issue.kind)) throw new Error(`${location} has an unsupported issue kind`);
        if (!Array.isArray(issue.evidence) || !issue.evidence.length || issue.evidence.some(entry => typeof entry !== 'string' || !entry.trim())) {
            throw new Error(`${location} requires non-empty evidence references for a correctness failure`);
        }
        throw new Error(`${location} reports a terminal ${issue.kind} failure: ${issue.message}`);
    }
}

export function readEvidence(filePath) {
    const evidence = readJsonObject(filePath, 'Evidence manifest');
    if (evidence.version !== 1) throw new Error('Evidence requires version 1');
    assertNoTerminalIssues(evidence.blockingIssues);
    return evidence;
}

export function readPhaseEvidence(filePath) {
    return readEvidence(filePath);
}

export function readDomainModel(filePath) {
    return readJsonObject(filePath, 'Domain manifest');
}

export function readSdkCompatibility(filePath) {
    const sdkReport = readPhaseEvidence(filePath).sdkCompatibility;
    if (!sdkReport || typeof sdkReport !== 'object' || Array.isArray(sdkReport)) throw new Error('Discovery report requires sdkCompatibility evidence');
    return { sdkReport, sdkReportContent: `${JSON.stringify(sdkReport, null, 2)}\n` };
}
