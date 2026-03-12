/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTheme, type Theme } from '@mui/material';

/**
 * Gets the computed value of a CSS variable.
 * Returns a fallback if the variable is not defined or empty.
 */
function getCSSVar(varName: string, fallback: string): string {
    if (typeof document === 'undefined') return fallback;
    const style = getComputedStyle(document.documentElement);
    const value = style.getPropertyValue(varName).trim();
    return value || fallback;
}

/**
 * Gets a fingerprint of the current VS Code theme based on key CSS variables.
 * This changes when the actual theme changes, even between themes of the same kind (dark to dark).
 */
export function getVSCodeThemeFingerprint(): string {
    if (typeof document === 'undefined') return '';
    const style = getComputedStyle(document.documentElement);
    // Combine key colors that typically differ between themes
    const bg = style.getPropertyValue('--vscode-editor-background').trim();
    const fg = style.getPropertyValue('--vscode-editor-foreground').trim();
    const accent = style.getPropertyValue('--vscode-button-background').trim();
    return `${bg}|${fg}|${accent}`;
}

/**
 * Creates a MUI theme that adapts to VS Code's theme using CSS variables.
 * This ensures the MUI components match the VS Code editor's look and feel.
 * @param themeKind - The VS Code theme kind (e.g., 'vscode-dark', 'vscode-light')
 *                    Used to trigger theme recreation when VS Code theme changes.
 */
export function createVSCodeMuiTheme(themeKind: string): Theme {
    const isDarkMode = themeKind !== 'vscode-light';

    // Get computed colors for palette (MUI requires actual color values, not CSS vars)
    // Fallback values based on VS Code's default dark/light themes
    const buttonBackground = getCSSVar('--vscode-button-background', isDarkMode ? '#0078d4' : '#007acc');
    const buttonForeground = getCSSVar('--vscode-button-foreground', '#ffffff');
    const buttonSecondaryBackground = getCSSVar(
        '--vscode-button-secondaryBackground',
        isDarkMode ? '#313131' : '#5f6a79',
    );
    const buttonSecondaryForeground = getCSSVar(
        '--vscode-button-secondaryForeground',
        isDarkMode ? '#cccccc' : '#ffffff',
    );
    const editorBackground = getCSSVar('--vscode-editor-background', isDarkMode ? '#1f1f1f' : '#ffffff');
    const editorForeground = getCSSVar('--vscode-editor-foreground', isDarkMode ? '#cccccc' : '#000000');
    const foreground = getCSSVar('--vscode-foreground', isDarkMode ? '#cccccc' : '#616161');
    const errorForeground = getCSSVar('--vscode-errorForeground', isDarkMode ? '#f85149' : '#e51400');
    const disabledForeground = getCSSVar('--vscode-disabledForeground', isDarkMode ? '#cccccc80' : '#61616180');
    const panelBorder = getCSSVar('--vscode-panel-border', isDarkMode ? '#2b2b2b' : '#80808059');
    const listHoverBackground = getCSSVar('--vscode-list-hoverBackground', isDarkMode ? '#2a2d2e' : '#f0f0f0');
    const listActiveSelectionBackground = getCSSVar(
        '--vscode-list-activeSelectionBackground',
        isDarkMode ? '#04395e' : '#0060c0',
    );
    const listActiveSelectionForeground = getCSSVar('--vscode-list-activeSelectionForeground', '#ffffff');
    const focusBorder = getCSSVar('--vscode-focusBorder', isDarkMode ? '#0078d4' : '#0090f1');

    // Additional colors for components
    const iconForeground = getCSSVar('--vscode-icon-foreground', isDarkMode ? '#cccccc' : '#424242');
    const toolbarHoverBackground = getCSSVar(
        '--vscode-toolbar-hoverBackground',
        isDarkMode ? '#5a5d5e50' : '#b8b8b850',
    );
    const menuBackground = getCSSVar('--vscode-menu-background', isDarkMode ? '#1f1f1f' : '#ffffff');
    const menuForeground = getCSSVar('--vscode-menu-foreground', isDarkMode ? '#cccccc' : '#616161');
    const menuBorder = getCSSVar('--vscode-menu-border', isDarkMode ? '#454545' : '#cccccc');
    const menuSelectionBackground = getCSSVar('--vscode-menu-selectionBackground', isDarkMode ? '#0078d4' : '#0060c0');
    const menuSelectionForeground = getCSSVar('--vscode-menu-selectionForeground', '#ffffff');
    const widgetShadow = getCSSVar('--vscode-widget-shadow', isDarkMode ? '#0000005c' : '#00000029');
    const widgetBackground = getCSSVar('--vscode-editorWidget-background', isDarkMode ? '#202020' : '#f3f3f3');
    const widgetForeground = getCSSVar('--vscode-editorWidget-foreground', isDarkMode ? '#cccccc' : '#616161');
    const widgetBorder = getCSSVar('--vscode-widget-border', isDarkMode ? '#313131' : '#c8c8c8');

    return createTheme({
        palette: {
            mode: isDarkMode ? 'dark' : 'light',
            primary: {
                main: buttonBackground,
                contrastText: buttonForeground,
            },
            secondary: {
                main:
                    buttonSecondaryBackground === '#00000000'
                        ? isDarkMode
                            ? '#313131'
                            : '#5f6a79'
                        : buttonSecondaryBackground,
                contrastText: buttonSecondaryForeground,
            },
            error: {
                main: errorForeground,
            },
            background: {
                default: editorBackground,
                paper: editorBackground,
            },
            text: {
                primary: editorForeground,
                secondary: foreground,
                disabled: disabledForeground,
            },
            divider: panelBorder,
            action: {
                active: editorForeground,
                hover: listHoverBackground,
                selected: listActiveSelectionBackground,
                disabled: disabledForeground,
                focus: focusBorder,
            },
        },
        components: {
            MuiPaper: {
                styleOverrides: {
                    root: {
                        backgroundImage: 'none',
                        backgroundColor: editorBackground,
                    },
                },
            },
            MuiTableContainer: {
                styleOverrides: {
                    root: {
                        backgroundColor: 'transparent',
                    },
                },
            },
            MuiTable: {
                styleOverrides: {
                    root: {
                        backgroundColor: editorBackground,
                    },
                },
            },
            MuiTableHead: {
                styleOverrides: {
                    root: {
                        backgroundColor: editorBackground,
                        '& .MuiTableCell-head': {
                            backgroundColor: `${editorBackground} !important`,
                            color: editorForeground,
                            fontWeight: 600,
                            borderBottom: `1px solid ${panelBorder}`,
                        },
                    },
                },
            },
            MuiTableBody: {
                styleOverrides: {
                    root: {
                        backgroundColor: editorBackground,
                        '& .MuiTableRow-root': {
                            backgroundColor: editorBackground,
                        },
                    },
                },
            },
            MuiTableRow: {
                styleOverrides: {
                    root: {
                        backgroundColor: `${editorBackground} !important`,
                        '&:hover': {
                            backgroundColor: `${listHoverBackground} !important`,
                        },
                        '&.Mui-selected': {
                            backgroundColor: `${listActiveSelectionBackground} !important`,
                            '& .MuiTableCell-root': {
                                color: listActiveSelectionForeground,
                            },
                            '&:hover': {
                                backgroundColor: `${listActiveSelectionBackground} !important`,
                            },
                        },
                    },
                },
            },
            MuiTableCell: {
                styleOverrides: {
                    root: {
                        color: editorForeground,
                        backgroundColor: `${editorBackground} !important`,
                        borderBottom: `1px solid ${panelBorder}`,
                        padding: '4px 8px',
                        fontSize: '13px',
                    },
                    head: {
                        backgroundColor: `${editorBackground} !important`,
                        color: editorForeground,
                        fontWeight: 600,
                    },
                },
            },
            MuiCheckbox: {
                styleOverrides: {
                    root: {
                        color: 'var(--vscode-editor-foreground)',
                        backgroundColor: 'transparent',
                        padding: '4px',
                        '&.Mui-checked': {
                            color: 'var(--vscode-editor-foreground)',
                        },
                        '&:hover': {
                            backgroundColor: 'transparent',
                        },
                    },
                },
            },
            MuiIconButton: {
                styleOverrides: {
                    root: {
                        color: iconForeground,
                        '&:hover': {
                            backgroundColor: toolbarHoverBackground,
                        },
                    },
                },
            },
            MuiMenu: {
                styleOverrides: {
                    paper: {
                        backgroundColor: menuBackground,
                        border: `1px solid ${menuBorder}`,
                        boxShadow: `0 2px 8px ${widgetShadow}`,
                    },
                },
            },
            MuiMenuItem: {
                styleOverrides: {
                    root: {
                        color: menuForeground,
                        fontSize: '13px',
                        '&:hover': {
                            backgroundColor: menuSelectionBackground,
                            color: menuSelectionForeground,
                        },
                        '&.Mui-selected': {
                            backgroundColor: menuSelectionBackground,
                            color: menuSelectionForeground,
                        },
                    },
                },
            },
            MuiListItemIcon: {
                styleOverrides: {
                    root: {
                        color: 'inherit',
                        minWidth: '28px',
                    },
                },
            },
            MuiListItemText: {
                styleOverrides: {
                    primary: {
                        fontSize: '13px',
                    },
                },
            },
            MuiTooltip: {
                styleOverrides: {
                    tooltip: {
                        backgroundColor: widgetBackground,
                        color: widgetForeground,
                        border: `1px solid ${widgetBorder}`,
                        fontSize: '12px',
                    },
                },
            },
            MuiSvgIcon: {
                styleOverrides: {
                    root: {
                        fontSize: '16px',
                    },
                },
            },
        },
        typography: {
            fontFamily: 'var(--vscode-font-family)',
            fontSize: 13,
        },
        shape: {
            borderRadius: 2,
        },
    });
}
