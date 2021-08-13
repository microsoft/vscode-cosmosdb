module.exports = {
    "extends": "@microsoft/eslint-config-azuretools",
    "rules": {
        "import/no-internal-modules": [ "error", {
            "allow": [ "antlr4ts/**" ]
        } ]
    }
};
