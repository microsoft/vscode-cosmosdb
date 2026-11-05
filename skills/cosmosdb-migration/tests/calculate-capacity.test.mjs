import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { calculateCapacity } from '../scripts/calculate-capacity.mjs';

test('sizes against a supplied or ratio-derived peak without any extra buffer', () => {
    for (const peakInput of [
        { estimatedAverageRuPerSecond: 550, peakToAverageRatio: 2 },
        { estimatedPeakRuPerSecond: 1100 },
    ]) {
        assert.deepEqual(calculateCapacity({ ...peakInput, spikyOrSeasonal: true, monthlyGrowthPercent: 11 }), {
            bufferMultiplier: 1,
            derivedPeakRuPerSecond: 1100,
            recommendedAutoscaleMaxRuPerSecond: 2000,
        });
    }
});

test('uses a 3x buffer for growth above ten percent when no peak is supplied', () => {
    const result = calculateCapacity({
        estimatedAverageRuPerSecond: 1200,
        monthlyGrowthPercent: 11,
    });
    assert.equal(result.bufferMultiplier, 3);
    assert.equal(result.recommendedAutoscaleMaxRuPerSecond, 4000);
});

test('does not infer service eligibility', () => {
    const result = calculateCapacity({ estimatedAverageRuPerSecond: 100 });
    assert.equal(result.recommendedAutoscaleMaxRuPerSecond, 1000);
    assert.equal(Object.hasOwn(result, 'serverlessAssessment'), false);
});

test('rejects invalid and incomplete numeric inputs', () => {
    assert.throws(() => calculateCapacity({ peakToAverageRatio: 2 }), /requires estimatedAverage/u);
    assert.throws(() => calculateCapacity({ estimatedPeakRuPerSecond: -1 }), /positive/u);
});

test('accepts an explicit peak equal to average and a ratio of one without a buffer', () => {
    for (const peakInput of [{ estimatedPeakRuPerSecond: 1100 }, { peakToAverageRatio: 1 }]) {
        assert.deepEqual(calculateCapacity({ estimatedAverageRuPerSecond: 1100, ...peakInput }), {
            bufferMultiplier: 1,
            derivedPeakRuPerSecond: 1100,
            recommendedAutoscaleMaxRuPerSecond: 2000,
        });
    }
});

test('rejects an explicit peak below average even when a valid ratio is supplied', () => {
    for (const ratioInput of [{}, { peakToAverageRatio: 2 }]) {
        assert.throws(
            () => calculateCapacity({ estimatedAverageRuPerSecond: 5000, estimatedPeakRuPerSecond: 1000, ...ratioInput }),
            /estimatedPeakRuPerSecond must be at least estimatedAverageRuPerSecond/u,
        );
    }
});

test('rejects ratios below one and invalid ratios even when an explicit peak is supplied', () => {
    for (const peakToAverageRatio of [1 - Number.EPSILON, Number.MIN_VALUE, 0, -1, NaN, Infinity, -Infinity, '2', null]) {
        for (const peakInput of [{}, { estimatedPeakRuPerSecond: 2000 }]) {
            assert.throws(
                () => calculateCapacity({ estimatedAverageRuPerSecond: 1000, peakToAverageRatio, ...peakInput }),
                /peakToAverageRatio must be/u,
            );
        }
    }
});

test('preserves explicit peak precedence over inconsistent valid ratios, including unused overflow', () => {
    for (const peakToAverageRatio of [1, 4, Number.MAX_VALUE]) {
        assert.deepEqual(calculateCapacity({
            estimatedAverageRuPerSecond: 550,
            estimatedPeakRuPerSecond: 1100,
            peakToAverageRatio,
            monthlyGrowthPercent: 11,
            spikyOrSeasonal: true,
        }), {
            bufferMultiplier: 1,
            derivedPeakRuPerSecond: 1100,
            recommendedAutoscaleMaxRuPerSecond: 2000,
        });
    }
});

test('rejects a ratio-derived peak that overflows finite inputs', () => {
    assert.throws(
        () => calculateCapacity({ estimatedAverageRuPerSecond: Number.MAX_VALUE, peakToAverageRatio: 2 }),
        /derivedPeakRuPerSecond must be a positive finite number/u,
    );
});

test('rejects buffered recommendations that overflow finite inputs', () => {
    for (const input of [
        { estimatedAverageRuPerSecond: Number.MAX_VALUE },
        { estimatedAverageRuPerSecond: Number.MAX_VALUE / 2, monthlyGrowthPercent: 11 },
        { estimatedAverageRuPerSecond: Number.MAX_VALUE / 2, spikyOrSeasonal: true },
    ]) {
        assert.throws(
            () => calculateCapacity(input),
            /recommendedAutoscaleMaxRuPerSecond must be a positive finite number/u,
        );
    }
});

test('retains finite rounded output for extreme valid inputs without imposing service limits', () => {
    for (const input of [
        { estimatedPeakRuPerSecond: Number.MAX_VALUE },
        { estimatedAverageRuPerSecond: Number.MAX_VALUE, peakToAverageRatio: 1 },
        { estimatedAverageRuPerSecond: Number.MAX_VALUE / 4 },
        { estimatedAverageRuPerSecond: Number.MIN_VALUE, peakToAverageRatio: 1 },
    ]) {
        const result = calculateCapacity(input);
        assert(Number.isFinite(result.recommendedAutoscaleMaxRuPerSecond));
        assert(result.recommendedAutoscaleMaxRuPerSecond >= 1000);
        if (Object.hasOwn(result, 'derivedPeakRuPerSecond')) {
            assert(Number.isFinite(result.derivedPeakRuPerSecond));
        }
        assert.doesNotMatch(JSON.stringify(result), /null/u);
    }
});

test('preserves the growth threshold, seasonal buffer, minimum, and rounding', () => {
    for (const [options, bufferMultiplier, recommendedAutoscaleMaxRuPerSecond] of [
        [{}, 2, 3000],
        [{ monthlyGrowthPercent: 10 }, 2, 3000],
        [{ monthlyGrowthPercent: 10.01 }, 3, 4000],
        [{ spikyOrSeasonal: true }, 3, 4000],
    ]) {
        assert.deepEqual(calculateCapacity({ estimatedAverageRuPerSecond: 1200, ...options }), {
            bufferMultiplier,
            recommendedAutoscaleMaxRuPerSecond,
        });
    }
    assert.deepEqual(calculateCapacity({ estimatedAverageRuPerSecond: 500 }), {
        bufferMultiplier: 2,
        recommendedAutoscaleMaxRuPerSecond: 1000,
    });
});

test('keeps missing throughput estimates unknown', () => {
    for (const [input, bufferMultiplier] of [
        [{}, 2],
        [{ monthlyGrowthPercent: 11 }, 3],
        [{ spikyOrSeasonal: true }, 3],
    ]) {
        assert.deepEqual(calculateCapacity(input), { bufferMultiplier });
    }
});

test('CLI rejects invalid or overflowing inputs with exit one and no stdout', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-capacity-inputs-'));
    try {
        const scriptPath = fileURLToPath(new URL('../scripts/calculate-capacity.mjs', import.meta.url));
        const inputPath = path.join(root, 'capacity-input.json');
        for (const [input, expectedError] of [
            [{ estimatedAverageRuPerSecond: 5000, estimatedPeakRuPerSecond: 1000 }, /estimatedPeakRuPerSecond/u],
            [{ estimatedAverageRuPerSecond: 1000, peakToAverageRatio: 0.5 }, /peakToAverageRatio/u],
            [{ estimatedAverageRuPerSecond: Number.MAX_VALUE, peakToAverageRatio: 2 }, /derivedPeakRuPerSecond/u],
            [{ estimatedAverageRuPerSecond: Number.MAX_VALUE }, /recommendedAutoscaleMaxRuPerSecond/u],
            [{ estimatedAverageRuPerSecond: Number.MAX_VALUE / 2, spikyOrSeasonal: true }, /recommendedAutoscaleMaxRuPerSecond/u],
        ]) {
            fs.writeFileSync(inputPath, JSON.stringify(input));
            const result = spawnSync(process.execPath, [scriptPath, inputPath], {
                cwd: root,
                encoding: 'utf8',
                timeout: 5000,
            });
            assert.ifError(result.error);
            assert.equal(result.signal, null);
            assert.equal(result.status, 1, result.stderr);
            assert.equal(result.stdout, '');
            assert.match(result.stderr, expectedError);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
