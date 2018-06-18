Note: The file `JavaScript.tmLanguage.json` is derived from [TypeScriptReact.tmLanguage](https://github.com/Microsoft/TypeScript-TmLanguage/blob/master/TypeScriptReact.tmLanguage).

# To update the grammar after making changes:
1. npm run update-grammar
2. Re-comment imports in mongoParser.ts that are not used and cause compile errors

# Debugging the grammar
See instructions in launch.json.  Be sure to explicitly save the mongo.g4 file to generate the debug info before trying to launch.

---
## *The following is out of date:*

~~To update to the latest version:~~

~~- `cd extensions/typescript` and run `npm run update-grammars`~~

~~- don't forget to run the integration tests at `./scripts/test-integration.sh`~~

~~The script does the following changes:~~

~~- fileTypes .tsx -> .js & .jsx~~

~~- scopeName scope.tsx -> scope.js~~

~~- update all rule names .tsx -> .js~~
