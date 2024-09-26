/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Curve, type CurvePath, type Vec3 } from './types';

const curveResolution = 128;

// Many of these functions are ported from ThreeJS, which is distributed under
// the MIT license. Retrieved from https://github.com/mrdoob/three.js on
// 14 October 2021.

function equals(v1: Vec3, v2: Vec3) {
    return v1[0] === v2[0] && v1[1] === v2[1] && v1[2] === v2[2];
}

function QuadraticBezierP0(t: number, p: number): number {
    const k = 1 - t;
    return k * k * p;
}

function QuadraticBezierP1(t: number, p: number): number {
    return 2 * (1 - t) * t * p;
}

function QuadraticBezierP2(t: number, p: number): number {
    return t * t * p;
}

function QuadraticBezier(t: number, p0: number, p1: number, p2: number): number {
    return QuadraticBezierP0(t, p0) + QuadraticBezierP1(t, p1) + QuadraticBezierP2(t, p2);
}

function getPointOnCurve(curve: Curve, t: number) {
    const [v0, v1, v2] = curve.points;
    return [
        QuadraticBezier(t, v0[0], v1[0], v2[0]),
        QuadraticBezier(t, v0[1], v1[1], v2[1]),
        QuadraticBezier(t, v0[2], v1[2], v2[2]),
    ] as Vec3;
}

function getPointsOnCurve(curve: Curve, divisions: number): Vec3[] {
    const points: Vec3[] = [];
    for (let d = 0; d <= divisions; d++) {
        points.push(getPointOnCurve(curve, d / divisions));
    }
    return points;
}

export function getPointsOnCurvePath(curvePath: CurvePath, divisions = curveResolution): Vec3[] {
    const points: Vec3[] = [];
    let last: Vec3 | undefined;

    for (let i = 0, curves = curvePath.curves; i < curves.length; i++) {
        const curve = curves[i];
        const pts = getPointsOnCurve(curve, divisions);

        for (const point of pts) {
            if (last && equals(last, point)) {
                // ensures no consecutive points are duplicates
                continue;
            }

            points.push(point);
            last = point;
        }
    }

    return points;
}
