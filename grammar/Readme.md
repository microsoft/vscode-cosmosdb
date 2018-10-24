Note: The file `JavaScript.tmLanguage.json` is derived from [TypeScriptReact.tmLanguage](https://github.com/Microsoft/TypeScript-TmLanguage/blob/master/TypeScriptReact.tmLanguage).

# To update the grammar after making changes:

1. npm run update-grammar
2. Re-comment imports in mongoParser.ts that are not used and cause compile errors

# Debugging the grammar

See instructions in launch.json. Be sure to explicitly save the mongo.g4 file to generate the debug info before trying to launch.
