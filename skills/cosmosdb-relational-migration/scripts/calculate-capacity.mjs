#!/usr/bin/env node
// Purpose: Calculate recommended Cosmos DB capacity from workload and storage estimates.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { showHelp } from './cli-help.mjs';

function requirePositiveNumber(value, name, allowZero = false) {
    const minimumAccepted = allowZero ? 0 : Number.MIN_VALUE;
    if (value !== undefined && (!Number.isFinite(value) || value < minimumAccepted)) {
        throw new Error(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} finite number when present.`);
    }
}

export function calculateCapacity(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Capacity input must be an object.');
    }

    const {
        estimatedAverageRuPerSecond,
        estimatedPeakRuPerSecond,
        peakToAverageRatio,
        monthlyGrowthPercent,
        spikyOrSeasonal = false,
    } = input;
    requirePositiveNumber(estimatedAverageRuPerSecond, 'estimatedAverageRuPerSecond');
    requirePositiveNumber(estimatedPeakRuPerSecond, 'estimatedPeakRuPerSecond');
    requirePositiveNumber(peakToAverageRatio, 'peakToAverageRatio');
    requirePositiveNumber(monthlyGrowthPercent, 'monthlyGrowthPercent', true);
    if (typeof spikyOrSeasonal !== 'boolean') throw new Error('spikyOrSeasonal must be a boolean when present.');
    if (peakToAverageRatio !== undefined && estimatedAverageRuPerSecond === undefined) {
        throw new Error('peakToAverageRatio requires estimatedAverageRuPerSecond.');
    }
    if (peakToAverageRatio !== undefined && peakToAverageRatio < 1) {
        throw new Error('peakToAverageRatio must be at least 1.');
    }
    if (
        estimatedAverageRuPerSecond !== undefined &&
        estimatedPeakRuPerSecond !== undefined &&
        estimatedPeakRuPerSecond < estimatedAverageRuPerSecond
    ) {
        throw new Error('estimatedPeakRuPerSecond must be at least estimatedAverageRuPerSecond.');
    }

    const derivedPeakRuPerSecond =
        estimatedPeakRuPerSecond ??
        (peakToAverageRatio !== undefined ? estimatedAverageRuPerSecond * peakToAverageRatio : undefined);
    requirePositiveNumber(derivedPeakRuPerSecond, 'derivedPeakRuPerSecond');
    const sizingRuPerSecond = derivedPeakRuPerSecond ?? estimatedAverageRuPerSecond;
    const peakIsKnown = derivedPeakRuPerSecond !== undefined;
    const bufferMultiplier = peakIsKnown ? 1 : monthlyGrowthPercent > 10 || spikyOrSeasonal ? 3 : 2;
    const recommendedAutoscaleMaxRuPerSecond =
        sizingRuPerSecond === undefined
            ? undefined
            : Math.max(1000, Math.ceil((sizingRuPerSecond * bufferMultiplier) / 1000) * 1000);
    requirePositiveNumber(recommendedAutoscaleMaxRuPerSecond, 'recommendedAutoscaleMaxRuPerSecond');

    return {
        bufferMultiplier,
        ...(derivedPeakRuPerSecond === undefined ? {} : { derivedPeakRuPerSecond }),
        ...(recommendedAutoscaleMaxRuPerSecond === undefined ? {} : { recommendedAutoscaleMaxRuPerSecond }),
    };
}

export function runCli(argv) {
        if (showHelp(argv, `
Usage: node calculate-capacity.mjs <capacity-input.json>

Read-only autoscale sizing arithmetic; outputs JSON, not a workload assessment.
Input path resolves from the current working directory. Optional JSON fields:

    estimatedAverageRuPerSecond  Positive number.
    estimatedPeakRuPerSecond     Positive number >= average when present; takes precedence over the ratio.
    peakToAverageRatio           Number >= 1; requires estimatedAverageRuPerSecond.
    monthlyGrowthPercent        Non-negative number.
    spikyOrSeasonal              Boolean; default false.

All numeric fields must be finite. Average, peak, and ratio must describe the same
workload scope and observation period. Derived peak and rounded output must remain finite.
A known peak receives no extra buffer. Otherwise the buffer is 3x for growth above
10% or spiky/seasonal workloads, 2x otherwise. Autoscale is rounded up to 1000 RU/s.
Without RU estimates, no throughput recommendation is emitted. Does not size storage.
Exit: 0 on success; 1 for invalid arguments, JSON, or input values.
`)) return 0;
    if (argv.length !== 1) {
        process.stderr.write('Usage: calculate-capacity.mjs <capacity-input.json>\n');
        return 1;
    }

    try {
        const input = JSON.parse(fs.readFileSync(path.resolve(argv[0]), 'utf8'));
        process.stdout.write(`${JSON.stringify(calculateCapacity(input), null, 2)}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        return 1;
    }
}

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli(process.argv.slice(2));
