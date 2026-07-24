/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ─── Cosmos DB account environment classifier ─────────────────────────────────────
//
// Single source of truth for "is this account production or non-production?" from its Azure resource tags,
// subscription name, and account name. Used by environment-dependent advisories (the DX-008 multi-region-writes
// antipattern), where treating a production account as non-prod — or vice versa — produces a wrong recommendation.
// Ported from CODA's `framework/env_classifier.py` so the two tools infer the same environment.
//
// Why this is not a simple substring check:
//   - Asymmetric substring matching is wrong. Matching non-prod tokens by substring (`name.includes('dev')`)
//     without also recognising `prod` mis-classifies names like `stagecoach-prod` (contains "stage"),
//     `prod-devbox` (contains "dev"), and `qatar-prod` (contains "qa").
//   - Embedded tokens have no separators. Real account names concatenate env tokens with no delimiters (e.g.
//     `...nonprodjpe01`), so `nonprod` must be matched before the bare `prod` substring inside it.
//
// Approach:
//   1. Tags (highest priority) — values are normalised through a synonym table to a canonical token; values
//      that aren't environments (`premium`, `ga`) are ignored rather than misread.
//   2. Subscription name — more deliberately curated than the account name; ranks above it.
//   3. Account name — an ordered, boundary-aware regex chain. Non-prod and negation patterns run first; `prod`
//      runs last so it never wins over an embedded `nonprod`.
//
// A specific account-level non-prod env (e.g. `uat`) overrides a broad subscription `prod` — the account name
// carries the more specific signal. Unknown stays unknown, and callers treat unknown as production
// (conservative — never assert a wasteful verdict without a positive signal).

/** Tag keys consulted, in priority order. Comparison is case-insensitive. */
const TAG_KEY_PRIORITY = [
    'environment',
    'env',
    'stage',
    'tier',
    'deployment',
    'deploymentenvironment',
    'envname',
    'environmenttype',
    'env_type',
    'app_env',
    'application_env',
    'applicationenvironment',
    'workload_environment',
];

/**
 * Every recognised tag/name value maps to a canonical environment. Values not in this map are ignored (so
 * SKU-class values like "premium" or "ga" never leak through as an environment).
 */
const VALUE_SYNONYMS: Record<string, string> = {
    prod: 'prod',
    production: 'prod',
    prd: 'prod',
    live: 'prod',
    dev: 'dev',
    development: 'dev',
    develop: 'dev',
    nonprod: 'dev',
    'non-prod': 'dev',
    nprd: 'dev',
    nonprd: 'dev',
    test: 'test',
    tst: 'test',
    qa: 'test',
    quality: 'test',
    integration: 'test',
    int: 'test',
    e2e: 'test',
    sit: 'test',
    smoke: 'test',
    canary: 'test',
    pilot: 'test',
    ring1: 'test',
    ring2: 'test',
    r1: 'test',
    r2: 'test',
    staging: 'staging',
    stag: 'staging',
    stg: 'staging',
    preprod: 'preprod',
    'pre-prod': 'preprod',
    preprd: 'preprod',
    pp: 'preprod',
    ppr: 'preprod',
    uat: 'uat',
    useracceptance: 'uat',
    perf: 'perf',
    performance: 'perf',
    load: 'perf',
    loadtest: 'perf',
    stresstest: 'perf',
    sandbox: 'sandbox',
    sbox: 'sandbox',
    demo: 'sandbox',
    poc: 'sandbox',
    trial: 'sandbox',
    experiment: 'sandbox',
    lab: 'sandbox',
    labs: 'sandbox',
};

/**
 * Ordered name-pattern chain — earlier matches win. Boundary-required patterns precede no-separator catch-alls;
 * non-prod/negation precede prod so an embedded "prod" inside "nonprod" never wins.
 */
const NAME_REGEXES: { pattern: RegExp; env: string; reason: string }[] = [
    { pattern: /(?<![a-z])(non-?prod|nprd|nonprd)(?![a-z])/i, env: 'dev', reason: 'name contains nonprod/nprd' },
    { pattern: /^not-(prod|production|prd)([-_.]|$)/i, env: 'dev', reason: 'name starts with not-prod' },
    { pattern: /(?<![a-z])(pre-?prod|preprd|ppr)(?![a-z])/i, env: 'preprod', reason: 'name contains preprod' },
    { pattern: /(^|[-_.])(pp)([-_.0-9]|$)/i, env: 'preprod', reason: 'name contains pp token' },
    { pattern: /(?<![a-z])(stag(?:ing)?|stg)(?![a-z])/i, env: 'staging', reason: 'name contains staging/stg' },
    { pattern: /(?<![a-z])uat(?![a-z])/i, env: 'uat', reason: 'name contains uat token' },
    {
        pattern: /(?<![a-z])(perf(?:ormance)?|loadtest|stresstest)(?![a-z])/i,
        env: 'perf',
        reason: 'name contains perf/loadtest',
    },
    { pattern: /(?<![a-z])load(?![a-z])/i, env: 'perf', reason: 'name contains load token' },
    {
        pattern: /(?<![a-z])(sandbox|sbox|demo|poc|trial|lab)(?![a-z])/i,
        env: 'sandbox',
        reason: 'name contains sandbox-class token',
    },
    { pattern: /(?<![a-z])(test|tst|qa)(?![a-z])/i, env: 'test', reason: 'name contains test/tst/qa token' },
    {
        pattern: /(?<![a-z])(e2e|sit|int(?:eg(?:ration)?)?)(?![a-z])/i,
        env: 'test',
        reason: 'name contains e2e/sit/int token',
    },
    { pattern: /(?<![a-z])(canary|pilot)(?![a-z])/i, env: 'test', reason: 'name contains canary/pilot' },
    { pattern: /(^|[-_.])(ring[0-9]+|r[12])([-_.]|$)/i, env: 'test', reason: 'name contains ring token' },
    // Prod — after every narrower non-prod pattern above. Separator-bounded first, then prodNN.
    {
        pattern: /(^|[-_.])(prod(?:uction)?|prd)([-_.]|$)/i,
        env: 'prod',
        reason: 'name contains prod token with separators',
    },
    { pattern: /(?<![a-z])prod[0-9]+/i, env: 'prod', reason: 'name contains prodNN' },
    { pattern: /^prod[a-z]*$/i, env: 'prod', reason: 'name starts with prod' },
    { pattern: /(^|[-_.])(dev(?:elopment)?)([-_.]|$)/i, env: 'dev', reason: 'name contains dev token with separators' },
    { pattern: /(?<![a-z])dev[0-9]+/i, env: 'dev', reason: 'name contains devNN' },
    // No-separator catch-alls (LAST): embedded env tokens in concatenated names. Non-prod precede prod so
    // "nonprodjpe01" classifies as non-prod, not on its embedded "prod".
    { pattern: /nonprod/i, env: 'dev', reason: 'embedded nonprod' },
    { pattern: /nprd/i, env: 'dev', reason: 'embedded nprd' },
    { pattern: /preprod(?![a-z])/i, env: 'preprod', reason: 'embedded preprod' },
    { pattern: /loadtest/i, env: 'perf', reason: 'embedded loadtest' },
    { pattern: /staging/i, env: 'staging', reason: 'embedded staging' },
    { pattern: /uat/i, env: 'uat', reason: 'embedded uat' },
    { pattern: /prod(?![a-z]{4,})/i, env: 'prod', reason: 'embedded prod token' },
    { pattern: /dev(?![a-z]{4,})/i, env: 'dev', reason: 'embedded dev token' },
    { pattern: /qa(?![a-z])/i, env: 'test', reason: 'embedded qa token' },
];

/** Account-level envs specific enough to override a broad subscription "prod". */
const SPECIFIC_NON_PROD = new Set(['dev', 'test', 'uat', 'staging', 'preprod', 'perf', 'sandbox']);
/** Any inferred env outside this set is non-production. "unknown" is treated as production by callers. */
const PROD_OR_UNKNOWN = new Set(['prod', 'unknown']);

export interface EnvClassification {
    /** prod | dev | test | staging | preprod | uat | perf | sandbox | unknown */
    inferredEnv: string;
    /** True when `inferredEnv` is not in {prod, unknown}. */
    isNonProd: boolean;
    /** Short prose: which signal fired. */
    signal: string;
}

function normalizeTagValue(value: string | undefined): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const s = String(value).trim().toLowerCase();
    if (!s || s === 'null') {
        return undefined;
    }
    if (VALUE_SYNONYMS[s]) {
        return VALUE_SYNONYMS[s];
    }
    const s2 = s.replace(/[^a-z0-9]/g, '');
    return VALUE_SYNONYMS[s2];
}

function classifyFromTags(tags: Record<string, string | undefined> | undefined): {
    env?: string;
    reason?: string;
} {
    const lowered = new Map<string, string | undefined>();
    for (const [k, v] of Object.entries(tags ?? {})) {
        if (v !== undefined && v !== null) {
            lowered.set(String(k).toLowerCase(), v);
        }
    }
    for (const key of TAG_KEY_PRIORITY) {
        if (lowered.has(key)) {
            const raw = lowered.get(key);
            const env = normalizeTagValue(raw);
            if (env) {
                return { env, reason: `tag ${key}=${JSON.stringify(raw)}` };
            }
        }
    }
    return {};
}

function classifyFromName(name: string): { env?: string; reason?: string } {
    if (!name) {
        return {};
    }
    for (const { pattern, env, reason } of NAME_REGEXES) {
        if (pattern.test(name)) {
            return { env, reason };
        }
    }
    return {};
}

/** Classify an account's environment from tags, subscription name, then account name. Pure. */
export function classifyEnvironment(
    accountName: string,
    tags?: Record<string, string | undefined>,
    subscriptionName?: string,
): EnvClassification {
    const tag = classifyFromTags(tags ?? {});
    const name = classifyFromName(accountName || '');
    const sub = classifyFromName(subscriptionName || '');

    let inferred: string;
    let signal: string;
    if (tag.env) {
        inferred = tag.env;
        signal = tag.reason ?? 'tag-based';
    } else if (name.env && SPECIFIC_NON_PROD.has(name.env) && sub.env === 'prod') {
        // A specific account-level non-prod env beats a broad subscription "prod".
        inferred = name.env;
        signal = `account name (${name.reason}) overrides subscription (${sub.reason})`;
    } else if (sub.env && sub.env !== 'unknown') {
        inferred = sub.env;
        signal = `subscription name: ${sub.reason}`;
    } else if (name.env && name.env !== 'unknown') {
        inferred = name.env;
        signal = name.reason ?? 'name-based';
    } else {
        inferred = 'unknown';
        signal = 'no recognized tag, subscription, or name signal';
    }

    return { inferredEnv: inferred, isNonProd: !PROD_OR_UNKNOWN.has(inferred), signal };
}
