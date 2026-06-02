/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as child from 'child_process';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
    MIN_DOTNET_SDK_VERSION,
    REQUESTED_DOTNET_SDK_CHANNEL,
    compareDotNetVersions,
    getInstalledDotNetSdkVersions,
    hasRequiredDotNetSdk,
} from './dotNetSdk';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: vi.fn(),
        },
    },
}));

// @microsoft/vscode-azext-utils transitively pulls in vscode via CJS requires. Stub the only
// symbol dotNetSdk uses (callWithTelemetryAndErrorHandling) so the module loads cleanly.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));

describe('dotNetSdk.compareDotNetVersions', () => {
    it('compares numeric major / minor / patch components', () => {
        expect(compareDotNetVersions('10.0.0', '9.0.0')).toBeGreaterThan(0);
        expect(compareDotNetVersions('9.0.0', '10.0.0')).toBeLessThan(0);
        expect(compareDotNetVersions('10.0.203', '10.0.100')).toBeGreaterThan(0);
        expect(compareDotNetVersions('10.1.0', '10.0.999')).toBeGreaterThan(0);
    });

    it('returns 0 for equal versions', () => {
        expect(compareDotNetVersions('10.0.203', '10.0.203')).toBe(0);
    });

    it('ignores pre-release / build suffixes after "-"', () => {
        expect(compareDotNetVersions('9.0.100-rc.1', '9.0.100')).toBe(0);
        expect(compareDotNetVersions('10.0.203-preview.1', '10.0.203-rc.2')).toBe(0);
    });

    it('treats missing components as zero', () => {
        expect(compareDotNetVersions('10', '10.0.0')).toBe(0);
        expect(compareDotNetVersions('10.0.0', '10')).toBe(0);
        expect(compareDotNetVersions('10.1', '10.0.999')).toBeGreaterThan(0);
    });

    it('treats non-numeric components as zero', () => {
        expect(compareDotNetVersions('abc.def.ghi', '0.0.0')).toBe(0);
    });
});

describe('dotNetSdk.REQUESTED_DOTNET_SDK_CHANNEL', () => {
    it('is the "major.minor" prefix of MIN_DOTNET_SDK_VERSION', () => {
        const expected = MIN_DOTNET_SDK_VERSION.split('.').slice(0, 2).join('.');
        expect(REQUESTED_DOTNET_SDK_CHANNEL).toBe(expected);
    });
});

describe('dotNetSdk.getInstalledDotNetSdkVersions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('parses one version per non-empty line of "dotnet --list-sdks" output', () => {
        (child.execFileSync as Mock).mockReturnValue(
            '8.0.404 [C:\\Program Files\\dotnet\\sdk]\r\n10.0.203 [C:\\Program Files\\dotnet\\sdk]\r\n',
        );
        expect(getInstalledDotNetSdkVersions()).toEqual(['8.0.404', '10.0.203']);
    });

    it('accepts Buffer return values from execFileSync', () => {
        (child.execFileSync as Mock).mockReturnValue(Buffer.from('9.0.100 [x]\n'));
        expect(getInstalledDotNetSdkVersions()).toEqual(['9.0.100']);
    });

    it('returns an empty array when execFileSync throws (dotnet not on PATH)', () => {
        (child.execFileSync as Mock).mockImplementation(() => {
            throw new Error('not found');
        });
        expect(getInstalledDotNetSdkVersions()).toEqual([]);
    });

    it('skips blank lines', () => {
        (child.execFileSync as Mock).mockReturnValue('\n9.0.100 [x]\n\n');
        expect(getInstalledDotNetSdkVersions()).toEqual(['9.0.100']);
    });

    it('invokes the supplied dotnetPath instead of "dotnet" when provided', () => {
        (child.execFileSync as Mock).mockReturnValue('10.0.203 [x]\n');
        getInstalledDotNetSdkVersions('/custom/dotnet');
        expect((child.execFileSync as Mock).mock.calls[0][0]).toBe('/custom/dotnet');
    });

    it('defaults to "dotnet" when no dotnetPath is provided', () => {
        (child.execFileSync as Mock).mockReturnValue('10.0.203 [x]\n');
        getInstalledDotNetSdkVersions();
        expect((child.execFileSync as Mock).mock.calls[0][0]).toBe('dotnet');
    });
});

describe('dotNetSdk.hasRequiredDotNetSdk', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns true when at least one installed SDK >= MIN_DOTNET_SDK_VERSION', () => {
        (child.execFileSync as Mock).mockReturnValue(`8.0.404 [x]\n${MIN_DOTNET_SDK_VERSION} [x]\n`);
        expect(hasRequiredDotNetSdk()).toBe(true);
    });

    it('returns false when all installed SDKs are below MIN_DOTNET_SDK_VERSION', () => {
        (child.execFileSync as Mock).mockReturnValue('8.0.404 [x]\n9.0.100 [x]\n');
        expect(hasRequiredDotNetSdk()).toBe(false);
    });

    it('returns false when no SDKs are installed (execFileSync throws)', () => {
        (child.execFileSync as Mock).mockImplementation(() => {
            throw new Error('not found');
        });
        expect(hasRequiredDotNetSdk()).toBe(false);
    });

    it('forwards the supplied dotnetPath to getInstalledDotNetSdkVersions', () => {
        (child.execFileSync as Mock).mockReturnValue(`${MIN_DOTNET_SDK_VERSION} [x]\n`);
        hasRequiredDotNetSdk('/custom/dotnet');
        expect((child.execFileSync as Mock).mock.calls[0][0]).toBe('/custom/dotnet');
    });
});
