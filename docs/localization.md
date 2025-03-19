# Localization

## Localize strings in source code

VS Code provides a localization API that allows you to localize strings in your extension. To do this, you need to:
- import the `vscode` module
- use the `vscode.l10n` API to mark strings for localization

Since in this extension there is a webview some modules or files are common for extension part and web part.
Therefore, we need to use `@vscode/l10n` package to localize strings in both part.

### Example
```typescript
import { l10n } from '@vscode/l10n';

const message = l10n.t('Hello {0}', name);
```

More details about localization API can be found in the [VS Code documentation](https://github.com/microsoft/vscode-l10n).

## Localize strings in package.json

Replace text fields with localized placeholders, such as `%extension.configuration.setting%`.
Add these placeholders to the `package.nls.json` file. The tool `@vscode/l10n-dev` will replace them with localized strings.

### package.json
```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "extension.configuration.setting": {
          "type": "string",
          "default": "%extension.configuration.setting.default%",
          "description": "%extension.configuration.setting.description%"
        }
      }
    }
  }
}
```

### package.nls.json
```json
{
  "extension.configuration.setting.default": "default value",
  "extension.configuration.setting.description": "description of the setting"
}
```

## Localize strings in webview

To localize strings in webview, you need to use the `@vscode/l10n` package. This package provides a `l10n` object
that you can use to mark strings for localization.

### Example
```typescript
import { l10n } from '@vscode/l10n';

const message = l10n.t('Hello {0}', name);

const component = () => {
    return (
        <div>
            <h1>{l10n.t('Hello {0}', name)}</h1>
        </div>
    );
}

```

## Collect strings for localization

To collect strings for localization, you need to use the `@vscode/l10n-dev` tool. This tool will scan your source code
and package.json files for strings marked for localization and generate a `package.nls.json` file with all the strings.
To use the tool, you need to add a script to your package.json file:

```json
{
  "scripts": {
    "l10n": "npx @vscode/l10n-dev export --outDir ./l10n ./src"
  }
}
```

Then, you can run the script to collect strings for localization:
```bash

npm run l10n
```

## Generate localized files

To generate localized files, you need to use the `@vscode/l10n-dev` tool. This tool will generate localized files for each language.

## !!! Warning

### Import

The tool `@vscode/l10n-dev` which collects all strings for localization requires importing `l10n` object only with following formats:
- `import { l10n } from '@vscode/l10n';`
- `import * as l10n from '@vscode/l10n';`
- `import * as vscode from 'vscode';`
- `import { l10n } from 'vscode';`

### Supported strings

`@vscode/l10n-dev` doesn't support strings which contain concatenation, conditions or template literals.
```typescript
// This is not supported
const message1 = l10n.t('Hello ' + name);
const message2 = l10n.t(`Hello ${name}`);
const message3 = l10n.t(name ? 'Hello {0}' : '', name);
const message4 = l10n.t('Hello \
{0}', name);
```

### Localization other dependencies

Sometimes you may need to localize strings in other dependencies. Unfortunately, `@vscode/l10n-dev` doesn't support this for many reasons.

In this extension we added strings from @microsoft/* packages to the localization bundle. Please DO NOT REMOVE THEM.
