/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const LICENSE_HEADER = `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/`;

const licenseHeaderRule = {
    meta: {
        type: 'layout',
        fixable: 'whitespace',
        schema: [],
    },
    create(context) {
        const sourceCode = context.sourceCode;

        return {
            Program(node) {
                const firstComment = sourceCode.getAllComments()[0];
                if (
                    firstComment &&
                    firstComment.loc.start.line === 1 &&
                    sourceCode.getText(firstComment).replaceAll('\r\n', '\n') === LICENSE_HEADER
                ) {
                    return;
                }

                if (firstComment && /Copyright|@license|SPDX-License-Identifier/i.test(firstComment.value)) {
                    context.report({
                        node: firstComment,
                        message: 'Invalid license header.',
                        fix: (fixer) => fixer.replaceText(firstComment, LICENSE_HEADER),
                    });
                    return;
                }

                context.report({
                    node,
                    message: 'Missing license header.',
                    fix: (fixer) => fixer.insertTextBefore(node, `${LICENSE_HEADER}\n\n`),
                });
            },
        };
    },
};

const noVscodeL10nRule = {
    meta: {
        type: 'problem',
        schema: [],
    },
    create(context) {
        return {
            MemberExpression(node) {
                if (
                    node.object.type === 'Identifier' &&
                    node.object.name === 'vscode' &&
                    node.property.type === 'Identifier' &&
                    node.property.name === 'l10n'
                ) {
                    context.report({
                        node,
                        message:
                            'Please use "import * as l10n from \'@vscode/l10n\';" and use l10n directly instead of vscode.l10n.',
                    });
                }
            },
        };
    },
};

const restrictedImports = new Map([
    ['nonNullValue', "Import nonNullValue from 'src/utils/nonNull' instead (isomorphic; avoids coupling to vscode)."],
    ['nonNullProp', "Import nonNullProp from 'src/utils/nonNull' instead (isomorphic; avoids coupling to vscode)."],
    [
        'nonNullOrEmptyValue',
        "Import nonNullOrEmptyValue from 'src/utils/nonNull' instead (isomorphic; avoids coupling to vscode).",
    ],
    [
        'nonNullValueAndProp',
        "Import nonNullValueAndProp from 'src/utils/nonNull' instead (isomorphic; avoids coupling to vscode).",
    ],
    ['openUrl', "Import openUrl from 'src/utils/openUrl' instead (single local source)."],
    ['randomUtils', 'Use the isomorphic Web Crypto API from globalThis.crypto instead, such as crypto.randomUUID().'],
    [
        'createContextValue',
        "Use TreeElementWithContextValue.createContextValue from 'src/tree/TreeElementWithContextValue' instead.",
    ],
]);

const restrictedImportsRule = {
    meta: {
        type: 'problem',
        schema: [],
    },
    create(context) {
        return {
            ImportDeclaration(node) {
                const source = node.source.value;

                for (const specifier of node.specifiers) {
                    if (source === 'vscode' && specifier.type === 'ImportDefaultSpecifier') {
                        context.report({
                            node: specifier,
                            message:
                                'Use \'import * as vscode from "vscode"\' instead. The default import is undefined in ESM.',
                        });
                        continue;
                    }

                    if (specifier.type !== 'ImportSpecifier') {
                        continue;
                    }

                    const importedName = specifier.imported.name ?? specifier.imported.value;
                    if (source === 'vscode' && importedName === 'l10n') {
                        context.report({
                            node: specifier,
                            message: "Import l10n from '@vscode/l10n' instead.",
                        });
                    } else if (source === '@microsoft/vscode-azext-utils') {
                        const message = restrictedImports.get(importedName);
                        if (message) {
                            context.report({ node: specifier, message });
                        }
                    }
                }
            },
        };
    },
};

export default {
    rules: {
        'license-header': licenseHeaderRule,
        'no-vscode-l10n': noVscodeL10nRule,
        'restricted-imports': restrictedImportsRule,
    },
};
