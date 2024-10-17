/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The following is a combination of several files retrieved from CSSWG’s
// CSS Color 4 module. It was modified to support TypeScript types adapted for
// the Fluent Blocks `colors` package and formatted to meet its style criteria.
import { type Vec3 } from './types';

/**
 * Simple matrix (and vector) multiplication
 * Warning: No error handling for incompatible dimensions!
 * @author Lea Verou 2020 MIT License
 */

type MatrixIO = number[][] | number[];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isFlat(A: any): A is number[] {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return !Array.isArray(A[0]);
}

// A is m x n. B is n x p. product is m x p.
export function multiplyMatrices(AMatrixOrVector: MatrixIO, BMatrixOrVector: MatrixIO): MatrixIO {
    const m = AMatrixOrVector.length;

    const A: number[][] = isFlat(AMatrixOrVector)
        ? // A is vector, convert to [[a, b, c, ...]]
          [AMatrixOrVector]
        : AMatrixOrVector;

    const B: number[][] = isFlat(BMatrixOrVector)
        ? // B is vector, convert to [[a], [b], [c], ...]]
          BMatrixOrVector.map((x) => [x])
        : BMatrixOrVector;

    const p = B[0].length;
    const B_cols = B[0].map((_, i) => B.map((x) => x[i])); // transpose B
    let product: MatrixIO = A.map((row) =>
        B_cols.map((col) => {
            if (!Array.isArray(row)) {
                return col.reduce((a, c) => a + c * row, 0);
            }

            return row.reduce((a, c, i) => a + c * (col[i] || 0), 0);
        }),
    );

    if (m === 1) {
        product = product[0]; // Avoid [[a, b, c, ...]]
    }

    if (p === 1) {
        return (product as number[][]).map((x) => x[0]); // Avoid [[a], [b], [c], ...]]
    }

    return product;
}

export function lin_sRGB(RGB: Vec3) {
    // convert an array of sRGB values
    // where in-gamut values are in the range [0 - 1]
    // to linear light (un-companded) form.
    // https://en.wikipedia.org/wiki/SRGB
    // Extended transfer function:
    // for negative values,  linear portion is extended on reflection of axis,
    // then reflected power function is used.
    return RGB.map((val) => {
        const sign = val < 0 ? -1 : 1;
        const abs = Math.abs(val);

        if (abs < 0.04045) {
            return val / 12.92;
        }

        return sign * Math.pow((abs + 0.055) / 1.055, 2.4);
    }) as Vec3;
}

export function gam_sRGB(RGB: Vec3) {
    // convert an array of linear-light sRGB values in the range 0.0-1.0
    // to gamma corrected form
    // https://en.wikipedia.org/wiki/SRGB
    // Extended transfer function:
    // For negative values, linear portion extends on reflection
    // of axis, then uses reflected pow below that
    return RGB.map((val) => {
        const sign = val < 0 ? -1 : 1;
        const abs = Math.abs(val);

        if (abs > 0.0031308) {
            return sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
        }

        return 12.92 * val;
    }) as Vec3;
}

export function lin_sRGB_to_XYZ(rgb: Vec3) {
    // convert an array of linear-light sRGB values to CIE XYZ
    // using sRGB's own white, D65 (no chromatic adaptation)

    const M = [
        [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
        [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
        [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
    ];
    return multiplyMatrices(M, rgb) as Vec3;
}

export function XYZ_to_lin_sRGB(XYZ: Vec3) {
    // convert XYZ to linear-light sRGB

    const M = [
        [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
        [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
        [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
    ];

    return multiplyMatrices(M, XYZ) as Vec3;
}

// Chromatic adaptation

export function D65_to_D50(XYZ: Vec3) {
    // Bradford chromatic adaptation from D65 to D50
    // The matrix below is the result of three operations:
    // - convert from XYZ to retinal cone domain
    // - scale components from one reference white to another
    // - convert back to XYZ
    // http://www.brucelindbloom.com/index.html?Eqn_ChromAdapt.html
    const M = [
        [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
        [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
        [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
    ];

    return multiplyMatrices(M, XYZ) as Vec3;
}

export function D50_to_D65(XYZ: Vec3) {
    // Bradford chromatic adaptation from D50 to D65
    const M = [
        [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
        [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
        [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
    ];

    return multiplyMatrices(M, XYZ) as Vec3;
}

// Lab and LCH

export function XYZ_to_Lab(XYZ: Vec3) {
    // Assuming XYZ is relative to D50, convert to CIE Lab
    // from CIE standard, which now defines these as a rational fraction
    const eps = 216 / 24389; // 6^3/29^3
    const kappa = 24389 / 27; // 29^3/3^3
    const white = [0.96422, 1.0, 0.82521]; // D50 reference white

    // compute xyz, which is XYZ scaled relative to reference white
    const xyz = XYZ.map((value, i) => value / white[i]);

    // now compute f
    const f = xyz.map((value) => (value > eps ? Math.cbrt(value) : (kappa * value + 16) / 116));

    return [
        116 * f[1] - 16, // L
        500 * (f[0] - f[1]), // a
        200 * (f[1] - f[2]), // b
    ] as Vec3;
}

export function Lab_to_XYZ(Lab: Vec3) {
    // Convert Lab to D50-adapted XYZ
    // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
    const kappa = 24389 / 27; // 29^3/3^3
    const eps = 216 / 24389; // 6^3/29^3
    const white = [0.96422, 1.0, 0.82521]; // D50 reference white
    const f: number[] = [];

    // compute f, starting with the luminance-related term
    f[1] = (Lab[0] + 16) / 116;
    f[0] = Lab[1] / 500 + f[1];
    f[2] = f[1] - Lab[2] / 200;

    // compute xyz
    const xyz = [
        Math.pow(f[0], 3) > eps ? Math.pow(f[0], 3) : (116 * f[0] - 16) / kappa,
        Lab[0] > kappa * eps ? Math.pow((Lab[0] + 16) / 116, 3) : Lab[0] / kappa,
        Math.pow(f[2], 3) > eps ? Math.pow(f[2], 3) : (116 * f[2] - 16) / kappa,
    ];

    // Compute XYZ by scaling xyz by reference white
    return xyz.map((value, i) => value * white[i]) as Vec3;
}

export function Lab_to_LCH(Lab: Vec3) {
    // Convert to polar form
    const hue = (Math.atan2(Lab[2], Lab[1]) * 180) / Math.PI;
    return [
        Lab[0], // L is still L
        Math.sqrt(Math.pow(Lab[1], 2) + Math.pow(Lab[2], 2)), // Chroma
        hue >= 0 ? hue : hue + 360, // Hue, in degrees [0 to 360)
    ] as Vec3;
}

export function LCH_to_Lab(LCH: Vec3) {
    // Convert from polar form
    return [
        LCH[0], // L is still L
        LCH[1] * Math.cos((LCH[2] * Math.PI) / 180), // a
        LCH[1] * Math.sin((LCH[2] * Math.PI) / 180), // b
    ] as Vec3;
}

export function sRGB_to_LCH(RGB: Vec3) {
    // convert an array of gamma-corrected sRGB values
    // in the 0.0 to 1.0 range
    // to linear-light sRGB, then to CIE XYZ,
    // then adapt from D65 to D50,
    // then convert XYZ to CIE Lab
    // and finally, convert to CIE LCH

    return Lab_to_LCH(XYZ_to_Lab(D65_to_D50(lin_sRGB_to_XYZ(lin_sRGB(RGB)))));
}

export function LCH_to_sRGB(LCH: Vec3) {
    // convert an array of CIE LCH values
    // to CIE Lab, and then to XYZ,
    // adapt from D50 to D65,
    // then convert XYZ to linear-light sRGB
    // and finally to gamma corrected sRGB
    // for in-gamut colors, components are in the 0.0 to 1.0 range
    // out of gamut colors may have negative components
    // or components greater than 1.0
    // so check for that :)

    return gam_sRGB(XYZ_to_lin_sRGB(D50_to_D65(Lab_to_XYZ(LCH_to_Lab(LCH)))));
}

export function LAB_to_sRGB(LAB: Vec3) {
    // convert an array of CIE Lab values to XYZ,
    // adapt from D50 to D65,
    // then convert XYZ to linear-light sRGB
    // and finally to gamma corrected sRGB
    // for in-gamut colors, components are in the 0.0 to 1.0 range
    // out of gamut colors may have negative components
    // or components greater than 1.0
    // so check for that :)

    return gam_sRGB(XYZ_to_lin_sRGB(D50_to_D65(Lab_to_XYZ(LAB))));
}

function is_LCH_inside_sRGB(l: number, c: number, h: number): boolean {
    const eps = 0.000005;
    const rgb = LCH_to_sRGB([+l, +c, +h]);
    return rgb.reduce((a: boolean, b: number) => a && b >= 0 - eps && b <= 1 + eps, true);
}

export function snap_into_gamut(Lab: Vec3): Vec3 {
    // Moves an LCH color into the sRGB gamut
    // by holding the l and h steady,
    // and adjusting the c via binary-search
    // until the color is on the sRGB boundary.

    // .0001 chosen fairly arbitrarily as "close enough"
    const eps = 0.0001;

    const LCH = Lab_to_LCH(Lab);
    const l = LCH[0];
    let c = LCH[1];
    const h = LCH[2];

    if (is_LCH_inside_sRGB(l, c, h)) {
        return Lab;
    }

    let hiC = c;
    let loC = 0;
    c /= 2;

    while (hiC - loC > eps) {
        if (is_LCH_inside_sRGB(l, c, h)) {
            loC = c;
        } else {
            hiC = c;
        }
        c = (hiC + loC) / 2;
    }

    return LCH_to_Lab([l, c, h]);
}
