/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import { ObjectID } from 'bson';
import { Position } from 'vscode';
import { parseError } from 'vscode-azureextensionui';
import { MongoCommand } from '../src/mongo/MongoCommand';
import { getAllCommandsFromText, getCommandFromTextAtLocation } from '../src/mongo/MongoScrapbook';

function expectSingleCommand(text: string): MongoCommand {
    let commands = getAllCommandsFromText(text);
    if (commands.length > 1) {
        assert.ok(false, "Too many commands found");
    }

    let command = commands[0];
    return command;
}

function testParse(
    text: string,
    expectedCommand: { collection: string | undefined, name: string | undefined, args: any[], firstErrorText?: string }
) {
    function testCore(text) {
        let command = expectSingleCommand(text);
        if (expectedCommand) {
            assert.ok(command, "Expected a command, but found none");

            assert.equal(command.collection || "", expectedCommand.collection || "", "Parsed collection name is not correct");
            assert.equal(command.name || "", expectedCommand.name || "", "Parsed command name is not correct");

            let actualArgs = (command.arguments || []).map(arg => JSON.parse(arg));
            assert.deepEqual(actualArgs, expectedCommand.args || [], "Parsed arguments are not correct");

        } else {
            assert.ok(!command, "Found a command, but expecting to find none");
            return;
        }

        if (expectedCommand && expectedCommand.firstErrorText) {
            assert.equal((command.errors || []).length > 0, true, "Expected at least one error");
            assert.equal(command.errors[0].message, expectedCommand.firstErrorText, "First error text was incorrect")
        } else {
            assert.equal((command.errors || []).length, 0, "Expected no errors");
        }
    }

    testCore(text);

    // Test again with LF changed to CR/LF
    let crlfText = text.replace(/\n/g, '\r\n');
    testCore(crlfText);

    // Test again with LF changed to multiple CR/LF
    let crlf2Text = text.replace(/\n/g, '\r\n\r\n');
    testCore(crlf2Text);

    // Test again with LF changed to CR
    let lfText = text.replace(/\n/g, '\r');
    testCore(lfText);

    // Test again with LF changed to tab
    let tabText = text.replace(/\n/g, '\t');
    testCore(tabText);

    // Test again with LF changed to space
    let spaceText = text.replace(/\n/g, ' ');
    testCore(spaceText);
}


function wrapInQuotes(word: string, numQuotes: number) { //0 to do nothing, 1 for single quotes, 2 for double quotes
    let result: string;
    if (numQuotes === 1) {
        result = `'${word}'`;
    } else if (numQuotes === 2) {
        result = `"${word}"`;
    } else {
        result = word;
    }
    return result;
}

suite("scrapbook parsing Tests", () => {
    test("find", () => {
        let text = "db.find()";
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.equal(command.text, text);
    });

    test("find with semicolon", () => {
        let text = "db.find();";
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.equal(command.text, text);
    });

    test("first of two commands, Mac/Linux", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a': 'b'})";
        let text = `${line1}\n${line2}`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.equal(command.text, line1);
    });

    test("second of two commands, Mac/Linux", () => {
        let line1 = "db.find()";
        for (let q = 0; q <= 2; q++) {
            let line2 = `db.insertOne({${wrapInQuotes("a", q)}:'b'})`;
            let text = `${line1}\n${line2}`;
            let command = getCommandFromTextAtLocation(text, new Position(2, 0));
            assert.equal(command.text, line2);
        }
    });

    test("second of two commands, Mac/Linux, semicolon", () => {
        let line1 = "db.find();";
        for (let q = 0; q <= 2; q++) {
            let line2 = `db.insertOne({${wrapInQuotes("a", q)}:'b'})`;
            let text = `${line1}\n${line2}`;
            let command = getCommandFromTextAtLocation(text, new Position(2, 0));
            assert.equal(command.text, line2);
        }
    });

    test("first of two commands, Windows", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a': 'b'})";
        let text = `${line1}\r\n${line2}`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.equal(command.text, line1);
    });

    test("second of two commands, Windows", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a':'b'})";
        let text = `${line1}\r\n${line2}`;
        let command = getCommandFromTextAtLocation(text, new Position(2, 0));
        assert.equal(command.text, line2);
    });

    test("second of two commands, lots of blank lines, Windows", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a':'b'})";
        let text = `\r\n\r\n\r\n\r\n\r\n\r\n${line1}\r\n\r\n\r\n\r\n\r\n\r\n${line2}\r\n\r\n\r\n\r\n\r\n\r\n`;
        let command = getCommandFromTextAtLocation(text, new Position(5, 0));
        assert.equal(command.text, line2);
    });

    test("first of two commands, Windows, on blank line before second command", () => {
        let line1 = "db.find()";
        for (let q = 0; q <= 2; q++) {
            let line2 = `db.insertOne({${wrapInQuotes("a", q)}:1})`;
            let text = `${line1}\r\n\r\n\r\n${line2}`;
            let command = getCommandFromTextAtLocation(text, new Position(2, 0));
            assert.equal(command.text, line1);
        }
    });

    test("drop", () => {
        testParse(
            `db.test.drop()`,
            { collection: "test", name: "drop", args: [] });
    });

    test("find, with empty object argument", () => {
        testParse(
            `db.test.find({})`,
            { collection: "test", name: "find", args: [{}] });
    });

    test("end-of-line comment", () => {
        testParse(
            `db.test.drop() // Ignore error "ns not found", it means "test" does not exist yet`,
            { collection: "test", name: "drop", args: [] });
    });

    test("multi-line insert from #214", () => {
        for (let q = 0; q <= 2; q++) {
            testParse(
                `db.heroes.insert({\n${wrapInQuotes("id", q)}: 2,\r\n${wrapInQuotes("name", q)}: "Batman",\r\n\r\n${wrapInQuotes("saying", q)}: "I'm Batman"\r})`,
                {
                    collection: "heroes", name: "insert", args: [
                        {
                            id: 2,
                            name: "Batman",
                            saying: "I'm Batman"
                        }
                    ]
                });
        }
    });

    test("find/project from #214", () => {
        testParse(
            `db.heroes.find({ "id": 2 }, { "saying": 1 })`,
            {
                collection: "heroes", name: "find", args: [
                    {
                        id: 2
                    },
                    {
                        saying: 1
                    }
                ]
            });
    });

    test("extraneous input", () => {
        testParse(
            `db.heros.find();
            hello there`,
            {
                collection: "heros",
                name: "find",
                args: [],
                firstErrorText: "mismatched input 'hello' expecting <EOF>"
            }
        )
    });

    test("empty", () => {
        testParse(
            "// hello there",
            undefined
        )
    });

    test("no command found, errors (will be tacked on to a blank command)", () => {
        testParse(
            "hello there",
            {
                collection: undefined,
                name: undefined,
                args: undefined,
                firstErrorText: "mismatched input 'hello' expecting <EOF>"
            }
        )
    });

    test("expect error: missing comma in arguments", () => {
        testParse(
            `db.heroes.find({ "id": 2 } { "saying": 1 })`,
            {
                collection: "heroes", name: "find", args: [
                    {
                        id: 2
                    }
                ],
                firstErrorText: "mismatched input '{' expecting {',', ')'}"
            }
        );

        testParse(
            `db.c.find({"a":[1,2,3]"b":1});`,
            {
                collection: 'c',
                name: 'find',
                args: [{ "a": [1, 2, 3] }],
                firstErrorText: "mismatched input '\"b\"' expecting {',', '}'}"
            }
        );

    });

    //https://github.com/Microsoft/vscode-cosmosdb/issues/467
    test("single quoted property names", () => {
        testParse(
            `db.heroes.find({ 'id': 2 }, { 'saying': 1 })`,
            {
                collection: "heroes", name: "find", args: [
                    {
                        id: 2
                    },
                    {
                        saying: 1
                    }
                ]
            });
    });
    test("expect error: missing function name", () => {
        // From https://github.com/Microsoft/vscode-cosmosdb/issues/659
        testParse(
            `db.c1.`,
            {
                collection: "c1",
                name: "",
                args: [],
                firstErrorText: "mismatched input '<EOF>' expecting IDENTIFIER"
            }
        );

        testParse(
            `db.c1.;`,
            {
                collection: "c1",
                name: "",
                args: [],
                firstErrorText: "mismatched input ';' expecting IDENTIFIER"
            }
        );

        testParse(
            `db.c1.(1, "a");`,
            {
                collection: "c1",
                name: "<missing IDENTIFIER>",
                args: [
                    1,
                    'a'
                ],
                firstErrorText: "missing IDENTIFIER at '('"
            }
        );

        testParse(
            `..(1, "a");`,
            {
                collection: undefined,
                name: undefined,
                args: undefined,
                firstErrorText: "mismatched input '.' expecting <EOF>"
            }
        );

        // Just make sure doesn't throw
        expectSingleCommand(`db..(1, "a");`);
        expectSingleCommand(`..c1(1, "a");`);
    });

    test("multi-line insert from #214", () => {
        testParse(
            `db.heroes.insert({\n"id": 2,\r\n"name": "Batman",\r\n\r\n"saying": "I'm Batman"\r})`,
            {
                collection: "heroes", name: "insert", args: [
                    {
                        id: 2,
                        name: "Batman",
                        saying: "I'm Batman"
                    }
                ]
            });
    });

    test("Array followed by } on separate line, from #73", () => {
        testParse(
            `db.createUser({
                "user": "buddhi",
                "pwd": "123",
                "roles": ["readWrite", "dbAdmin"]
                }
            )`,
            {
                collection: undefined,
                name: "createUser",
                args: [
                    {
                        user: "buddhi",
                        pwd: "123",
                        roles: ["readWrite", "dbAdmin"]
                    }
                ]
            });
    });

    test("Multiple line arrays, from #489", () => {
        testParse(`
            db.c2.insertMany([
                {"name": "Stephen", "age": 38, "male": true},
                {"name": "Stephen", "age": 38, "male": true}
                ])
            `,
            {
                collection: "c2",
                name: "insertMany",
                args: [
                    [
                        {
                            name: "Stephen",
                            age: 38,
                            male: true
                        },
                        {
                            name: "Stephen",
                            age: 38,
                            male: true
                        }
                    ]
                ]
            });
    });

    test("test function call that has 2 arguments", () => {
        let arg0 = `{"Age": 31}`;
        let arg1 = `{"Name": true}`;
        let text = `db.find(${arg0}\r\n,\r\n\r\n${arg1})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(JSON.parse(command.arguments![0]), JSON.parse(arg0));
        assert.deepEqual(JSON.parse(command.arguments![1]), JSON.parse(arg1));
    });
    test("test function call with nested parameters - documents in an array", () => {
        let arg0 = `[{"name": "a"}, {"name": "b"}, {"name": "c"}]`;
        let arg1 = `{"ordered": true}`;
        let text = `db.test1.insertMany(${arg0},\r\n\r\n\r\n${arg1})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(JSON.parse(command.arguments![0]), JSON.parse(arg0));
        assert.deepEqual(JSON.parse(command.arguments![1]), JSON.parse(arg1));
    });
    test("test function call that has a nested parameter", () => {
        let arg0 = `{"name": {"First" : "a", "Last":"b"} }`;
        let text = `db.test1.insertMany(${arg0})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(JSON.parse(command.arguments![0]), JSON.parse(arg0));
    });
    test("test function call with erroneous syntax: missing comma", () => {
        let arg0 = `{"name": {"First" : "a", "Last":"b"} }`;
        let arg1 = `{"ordered": true}`;
        let text = `db.test1.insertMany(${arg0}   ${arg1})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        const err = command.errors[0];
        assert.deepEqual(err.message, "mismatched input '{' expecting {',', ')'}");
        assert.deepEqual(err.range.start.line, 0);
        assert.deepEqual(err.range.start.character, 61);
    });
    test("test function call with erroneous syntax: missing comma, parameters separated with newline", () => {
        let arg0 = `{"name": {"First" : "a", "Last":"b"} }`;
        let arg1 = `{"ordered": \ntrue}`;
        let text = `db.test1.insertMany(${arg0} \n  ${arg1})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        const err = command.errors[0];
        assert.deepEqual(err.message, "mismatched input '{' expecting {',', ')'}");
        assert.deepEqual(err.range.start.line, 1);
        assert.deepEqual(err.range.start.character, 2);
    });
    test("test function call with erroneous syntax: missing double quote", () => {
        let text = `db.test1.insertMany({name": {"First" : "a", "Last":"b"} })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        const err = command.errors[0];
        assert.deepEqual(err.message, "missing \':\' at '\": {\"'");
        assert.deepEqual(err.range.start.line, 0);
        assert.deepEqual(err.range.start.character, 25);
    });
    test("test function call with erroneous syntax: missing opening brace", () => {
        let text = `db.test1.insertMany("name": {"First" : "a", "Last":"b"} })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        const err = command.errors[0];
        assert.deepEqual(err.message, "mismatched input ':' expecting {',', ')'}");
        assert.deepEqual(err.range.start.line, 0);
        assert.deepEqual(err.range.start.character, 26);
    });

    test("Chained command: to use pretty()", () => {
        testParse('db.timesheets.find().pretty();', {
            collection: "timesheets",
            name: "pretty",
            args: []
        });
    });

    // test("ISODate", () => {
    //     testParse('db.c1.insertOne({ "_id": ObjectId("5aecf1a63d8af732f07e4275"), "name": "Stephen", "date": ISODate("2018-05-01T00:00:00Z") });', {
    //         collection: "c1",
    //         name: "insertOne",
    //         args: [],
    //         firstErrorText: "Unexpected token O in JSON at position 7"
    //     });
    // });

    test("Keys with periods", () => {
        testParse(`db.timesheets.update( {
            "year":"2018",
            "month":"06"
            },{
            "$set":{
            "workers.0.days.0.something":"yupy!"
            }
            });
        `, {
                collection: "timesheets",
                name: "update",
                args: [
                    {
                        year: 2018,
                        month: "06"
                    },
                    {
                        "$set": {
                            "workers.0.days.0.something": "yupy!"
                        }
                    }
                ]
            });
    });

    test("nested objects", () => {
        testParse(`db.users.update({},{
            "$pull":{
            "proposals":{
            "$elemMatch":{"_id":"4qsBHLDCb755c3vPH"}
            }
            }
            })`, {
                collection: "users",
                name: "update",
                args: [
                    {},
                    {
                        "$pull": {
                            proposals: {
                                "$elemMatch": {
                                    _id: "4qsBHLDCb755c3vPH"
                                }
                            }
                        }
                    }
                ]
            });
    });
    test("test function call with and without quotes", () => {
        for (let q = 0; q <= 2; q++) {
            let text = `db.test1.insertMany({${wrapInQuotes("name", q)}: 'First' })`;
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            assert.deepEqual(command.argumentObjects, [{ name: "First" }]);
        }
    });
    test("test function call with numbers", () => {
        let text = `db.test1.insertMany({'name': 1010101})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: 1010101 }]);
    });
    test("test function call boolean", () => {
        let text = `db.test1.insertMany({'name': false})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: false }]);
    });
    test("test function call token inside quotes", () => {
        let text = `db.test1.insertMany({'name': 'false'})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: "false" }]);
    });
    test("test function call with an empty string property value", () => {
        let text = `db.test1.insertMany({'name': ''})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: "" }]);
    });
    test("test function call with array and multiple arguments", () => {
        let text = `db.test1.find({'roles': ['readWrite', 'dbAdmin']}, {'resources': ['secondary', 'primary']})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ roles: ["readWrite", "dbAdmin"] }, { resources: ["secondary", "primary"] }]);
    });
    test("test function call with nested objects", () => {
        let text = `db.test1.find({'roles': [{'optional': 'yes'}]}, {'resources': ['secondary', 'primary']})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ roles: [{ optional: "yes" }] }, { resources: ["secondary", "primary"] }]);
    });

    test("test incomplete function call - replicate user typing - no function call yet", () => {
        let text = `db.test1.`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, []);
        assert.deepEqual(command.collection, "test1");
    });

    test("test incomplete function call - replicate user typing - missing propertyValue", () => {
        let text = `db.test1.find({"name": {"First" : } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: { First: {} } }]);
    });

    test("test incomplete function call - replicate user typing - missing colon & propertyValue", () => {
        let text = `db.test1.find({"name": {"First"  } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: { First: {} } }]);
    });

    test("test incomplete function call - replicate user typing - empty array as argument", () => {
        let text = `db.heroes.aggregate([\n])`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [[]]);
    });

    test("test quotes inside a string - 1", () => {
        let text = `db.test1.find("That's all")`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, ["That's all"]);
    });

    test("test quotes inside a string - 2", () => {
        let text = `db.test1.find('That"s all')`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, ["That\"s all"]);
    });

    // Note: when escaping a character, escape it twice.
    test("test quotes inside a string - 3", () => {
        let text = `db.test1.find("Hello \\"there\\"")`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, ['Hello \\"there\\"']);
    });

    test("test quotes inside a string - 4", () => {
        let text = `db.test1.find('Hello \\'there\\'')`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, ["Hello \\'there\\'"]);
    });

    test("test nested property names (has dots in the name)", () => {
        let text = `db.test1.find({"name.FirstName": 1})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ "name.FirstName": 1 }]);
    });

    test("test managed namespace collection names (has dots in the name)", () => {
        let text = `db.test1.beep.find({})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.collection, "test1.beep");
    });

    test("test aggregate query", () => {
        for (let q = 0; q <= 2; q++) {
            let text = `db.orders.aggregate([
                { ${wrapInQuotes("$match", q)}: { ${wrapInQuotes("status", q)} : "A" } },
                { ${wrapInQuotes("$group", q)}: { ${wrapInQuotes("_id", q)}: "$cust_id", ${wrapInQuotes("total", q)}: { ${wrapInQuotes("$sum", q)}: "$amount" } } },
                { ${wrapInQuotes("$sort", q)}: { ${wrapInQuotes("total", q)}: -1 } }
                ],
                {
                    ${wrapInQuotes("cursor", q)}: { ${wrapInQuotes("batchSize", q)}: 0 }
                })`;
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            assert.deepEqual(command.collection, "orders");
            assert.deepEqual(command.argumentObjects, [[
                { "$match": { "status": "A" } },
                { "$group": { "_id": "$cust_id", "total": { "$sum": "$amount" } } },
                { "$sort": { "total": -1 } }
            ],
            {
                "cursor": { "batchSize": 0 }
            }]);
        }
    });
    /*
        //Examples inspired from https://docs.mongodb.com/manual/reference/operator/query/regex/
        test("test regular expressions - only pattern, no flags", () => {
            let text = `db.test1.beep.find({ sku: { $regex: /789$/ } })`;
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
            assert.deepEqual(generatedRegExp.flags, "");
            assert.deepEqual(generatedRegExp.source, "789$");
        });

        test("test regular expressions - pattern and flags", () => {
            let text = `db.test1.beep.find({ sku: { $regex: /789$/i } })`;
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
            assert.deepEqual(generatedRegExp.flags, "i");
            assert.deepEqual(generatedRegExp.source, "789$");
        });

        test("test regular expressions - Intellisense - flag contains invalid option", () => {
            let text = `db.test1.beep.find({ sku: { $regex: /789$/q } })`;
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            assert.deepEqual(command.errors[0].message, "mismatched input '}' expecting '('");
            assert.deepEqual(command.errors[0].range.start.character, 44);
        });
    */
    test("test ObjectID - no parameter", () => {
        let text = `db.c1.insert({"name": ObjectId()})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.collection, "c1");
        assert.ok((<any>command.argumentObjects[0]).name instanceof ObjectID);
    });

    test("test ObjectID - hex", () => {
        let idParam = "abcdef123456789012345678";
        let text = `db.c1.insert({"name": ObjectId("${idParam}")})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.collection, "c1");
        let id = new ObjectID(idParam);
        assert.deepEqual(command.argumentObjects, [{ name: id }]);
    });

    test("test faulty ObjectID - hex - extra characters", () => {
        let idParam = "abcdef12345678901234567890";
        let text = `db.c1.insert({"name": ObjectId("${idParam}")})`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let errorMessage = "Argument passed in must be a single String of 12 bytes or a string of 24 hex characters";
        assert.deepEqual(command.collection, "c1");
        assert.deepEqual(command.argumentObjects, [{ name: {} }]);
        assert.deepEqual(command.errors[0].message, errorMessage);
    });

    test("test faulty ObjectID - hex - fewer characters", () => {
        let idParam = "abcdef123456789012345";
        for (let i = 1; i < 3; i++) {
            let text = `db.c1.insert({"name": ObjectId(${wrapInQuotes(idParam, i)})})`;
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            let errorMessage = "Argument passed in must be a single String of 12 bytes or a string of 24 hex characters";
            assert.deepEqual(command.collection, "c1");
            assert.deepEqual(command.argumentObjects, [{ name: {} }]);
            assert.deepEqual(command.errors[0].message, errorMessage);
        }
    });
    //Examples inspired from https://docs.mongodb.com/manual/reference/operator/query/regex/
    test("test regular expressions - only pattern, no flags", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /789$/ } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
        assert.deepEqual(generatedRegExp.flags, "");
        assert.deepEqual(generatedRegExp.source, "789$");
    });

    test("test regular expressions - pattern and flags", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /789$/i } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
        assert.deepEqual(generatedRegExp.flags, "i");
        assert.deepEqual(generatedRegExp.source, "789$");
    });

    test("test regular expressions - Intellisense - flag contains invalid option", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /789$/q } })`;
        try {
            getCommandFromTextAtLocation(text, new Position(0, 0));
        } catch (error) {
            let err = parseError(error);
            assert.deepEqual("Unexpected node encountered", err.message);
        }
    });

    test("test regular expressions - wrong escape - throw error", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /789$\\/b\\/q } })`;
        try {
            getCommandFromTextAtLocation(text, new Position(0, 0));
        }
        catch (error) {
            assert.equal(error.message, "Invalid regular expression: /789$\\/b\\/: \\ at end of pattern");
        }
    });

    //Passing the following test should imply the rest of the tests pass too.
    // The regex parsing tests following this test should help zero-in on which case isn't handled properly.
    test("test regular expression parsing - with many special cases", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /^(hello?= world).*[^0-9]+|(world\\b\\*){0,2}$/g } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
        assert.deepEqual(generatedRegExp.flags, "g");
        assert.deepEqual(generatedRegExp.source, "^(hello?= world).*[^0-9]+|(world\\b\\*){0,2}$");
    });

    test("test regular expression parsing - with groupings", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /(?:hello)\\3/g } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
        assert.deepEqual(generatedRegExp.flags, "g");
        assert.deepEqual(generatedRegExp.source, "(?:hello)\\3");
    });

    test("test regular expression parsing - with special characters", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /(hello)*(world)?(name)+./g } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
        assert.deepEqual(generatedRegExp.flags, "g");
        assert.deepEqual(generatedRegExp.source, "(hello)*(world)?(name)+.");
    });


    test("test regular expression parsing - with boundaries", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /^(hello world)[^0-9]|(world\\b)$/g } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
        assert.deepEqual(generatedRegExp.flags, "g");
        assert.deepEqual(generatedRegExp.source, "^(hello world)[^0-9]|(world\\b)$");
    });

    test("test regular expression parsing - with quantifiers", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /(hello)*[^0-9]+|(world){0,2}./g } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
        assert.deepEqual(generatedRegExp.flags, "g");
        assert.deepEqual(generatedRegExp.source, "(hello)*[^0-9]+|(world){0,2}.");
    });


    test("test regular expression parsing - with conditional", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /(hello?= world)|(world)/g } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
        assert.deepEqual(generatedRegExp.flags, "g");
        assert.deepEqual(generatedRegExp.source, "(hello?= world)|(world)");
    });

    test("test regular expression parsing - with escaped special characters", () => {
        let text = `db.test1.beep.find({ sku: { $regex: /world\\*\\.\\?\\+/g } })`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        let generatedRegExp = (<any>command.argumentObjects[0]).sku.$regex;
        assert.deepEqual(generatedRegExp.flags, "g");
        assert.deepEqual(generatedRegExp.source, "world\\*\\.\\?\\+");
    });

    test("test chained command: argument aggregation", () => {
        testParse('db.timesheets.find({name: "Andy", surname: "Jackson"}).pretty();', {
            collection: "timesheets",
            name: "pretty",
            args: [{ name: "Andy", surname: "Jackson" }]
        });
    });

    test("Chained command - order of parsed arguments", () => {
        testParse('db.timesheets.find({name:"Andy"}).sort({age: 1}).skip(40);', {
            collection: "timesheets",
            name: "skip",
            args: [{ name: "Andy" }, { age: 1 }, 40]
        });
    });

    test("Chained command - missing period", () => {
        testParse('db.timesheets.find({name:"Andy"}).sort({age: 1})skip(40);', {
            collection: "timesheets",
            name: "sort",
            args: [{ name: "Andy" }, { age: 1 }],
            firstErrorText: "mismatched input 'skip' expecting <EOF>"
        });
    });


    test("Chained command - mid-type - missing bracket", () => {
        testParse('db.timesheets.find({name:"Andy"}).sort', {
            collection: "timesheets",
            name: "sort",
            args: [{ name: "Andy" }],
            firstErrorText: "mismatched input '<EOF>' expecting '('"
        });
    });

    test("Chained command - mid-type - typed the dot, but not the function call", () => {
        testParse('db.timesheets.find({name:"Andy"}).', {
            collection: "timesheets",
            name: "",
            args: [{ name: "Andy" }],
            firstErrorText: "mismatched input '<EOF>' expecting IDENTIFIER"
        });
    });


    //TODO: Tests to simulate cases where the user hasn't completed typing

    test("test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/688", () => {
        for (let q = 0; q <= 2; q++) {
            let text = `db.hdr.aggregate([
                { ${wrapInQuotes("$match", q)}: { "CURRENCY_ID": "USD" } },
              ])`; //Note the trailing comma. There should be 1 argument object returned, an array, that has 2 elements
            //one expected, and another empty object.
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            assert.deepEqual(command.collection, "hdr");
            assert.deepEqual(command.argumentObjects, [[{ $match: { "CURRENCY_ID": "USD" } }, {}]]);
        }
    });

    test("Chained command- test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/785", () => {
        testParse('db.timesheets.find({name:"Andy"}).count();', {
            collection: "timesheets",
            name: "count",
            args: [{ name: "Andy" }]
        });
    });

    test("Chained command- test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/795", () => {
        testParse('db.timesheets.find({}).limit(10);', {
            collection: "timesheets",
            name: "limit",
            args: [{}, 10]
        });
    });

    test("Chained command alternative for rs.slaveOk()- test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/565", () => {
        testParse('db.getMongo().setSlaveOk();', {
            collection: "",
            name: "setSlaveOk",
            args: []
        });
    });

    test("Multiple line command, from #489", () => {
        testParse(`
        db.finalists.find({name: "Jefferson"})
        .
        limit
        (10);
        `,
            {
                collection: "finalists",
                name: "limit",
                args: [
                    {
                        name: "Jefferson"
                    },
                    10
                ]
            });
    });


    test("test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/703", () => {
        for (let q = 0; q <= 2; q++) {
            let text = `db.Users.find({ ${wrapInQuotes("user", q)}: { ${wrapInQuotes("$in", q)}: [ "A80", "HPA" ] } },{ ${wrapInQuotes("_id", q)}: false });`;
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            assert.deepEqual(command.collection, "Users");
            assert.deepEqual(command.argumentObjects, [{ user: { "$in": ["A80", "HPA"] } }, { _id: false }]);
        }
    });

    test("test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/691", () => {
        for (let q = 0; q <= 2; q++) {
            let text = `db.users.aggregate([
                { ${wrapInQuotes("$match", q)}: {${wrapInQuotes("_id", q)}: {"$oid" :"5b23d2ba92b52cf794bdeb9c")}}},
                { ${wrapInQuotes("$project", q)}: {
                    ${wrapInQuotes("scores", q)}: {${wrapInQuotes("$filter", q)}: {
                        ${wrapInQuotes("input", q)}: '$scores',
                        ${wrapInQuotes("as", q)}: 'score',
                        ${wrapInQuotes("cond", q)}: {${wrapInQuotes("$gt", q)}: ['$$score', 3]}
                    }}
                }}
            ])`;
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            assert.deepEqual(command.collection, "users");
            assert.deepEqual(command.argumentObjects[0][0], { $match: { _id: { "$oid": "5b23d2ba92b52cf794bdeb9c" } } });
            assert.deepEqual(command.argumentObjects[0][1],
                {
                    $project: {
                        scores: {
                            $filter: {
                                input: '$scores',
                                as: 'score',
                                cond: { $gt: ['$$score', 3] }
                            }
                        }
                    }
                });
        }
    });

    test("test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/717", () => {
        for (let q = 0; q <= 2; q++) {
            let text = `db.Users.find({${wrapInQuotes("age", q)} : { ${wrapInQuotes("$in", q)} : [19, 20, 22, 25]}});`;
            let command = getCommandFromTextAtLocation(text, new Position(0, 0));
            assert.deepEqual(command.collection, "Users");
            assert.deepEqual(command.argumentObjects, [{ "age": { "$in": [19, 20, 22, 25] } }]);
        }
    });

    test("test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/737", () => {
        let text = `db.c1.insert({},f)`;
        let command = getCommandFromTextAtLocation(text, new Position(0, 0));
        assert.deepEqual(command.collection, "c1");
        assert.deepEqual(command.argumentObjects, [{}, {}]);
        assert.deepEqual(command.errors[0].message, "mismatched input 'f' expecting {'{', '[', RegexLiteral, StringLiteral, 'null', BooleanLiteral, NumericLiteral}")
    });

    test("test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/899 - multi-line comment, not regex", () => {
        for (let escape of ['\n', '\r', '\n\r', '\r\n']) {
            let text = `db.heroes.count()${escape}/*db.c2.insertMany([${escape}{"name": "Stephen", "age": 38, "male": true},${escape}{"name": "Stephen", "age": 38, "male": true}${escape}]);${escape}*/${escape}${escape}db.heroes.find();`;
            let commands = getAllCommandsFromText(text);
            assert.equal(commands.length, 2, `Error in parsing ${text}`);
            assert.equal(commands[0].name, "count");
            assert.equal(commands[1].name, "find");
        }
    });
});

