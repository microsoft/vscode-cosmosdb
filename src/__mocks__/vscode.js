// eslint-disable-next-line no-undef,@typescript-eslint/no-require-imports
const vsCodeMock = require('jest-mock-vscode').createVSCodeMock(jest);

vsCodeMock.l10n = {
    t: jest.fn(),
};
module.exports = vsCodeMock;
