/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { nonNullProp, parseError } from '@microsoft/vscode-azext-utils';
import assert from 'assert';
import { ObjectId } from 'bson';
import { Position } from 'vscode';
import { findCommandAtPosition, getAllCommandsFromText, type MongoCommand } from '../extension.bundle';

function expectSingleCommand(text: string): MongoCommand {
    const commands = getAllCommandsFromText(text);
    if (commands.length > 1) {
        assert.ok(false, 'Too many commands found');
    }

    return commands[0];
}

function testParse(
    text: string,
    expectedCommand:
        | { collection: string | undefined; name: string | undefined; args: any[] | undefined; firstErrorText?: string }
        | undefined,
): void {
    function testCore(coreText: string): void {
        const command = expectSingleCommand(coreText);
        if (expectedCommand) {
            assert.ok(command, 'Expected a command, but found none');

            assert.equal(
                command.collection || '',
                expectedCommand.collection || '',
                'Parsed collection name is not correct',
            );
            assert.equal(command.name || '', expectedCommand.name || '', 'Parsed command name is not correct');

            const actualArgs = (command.arguments || []).map((arg) => JSON.parse(arg));
            assert.deepEqual(actualArgs, expectedCommand.args || [], 'Parsed arguments are not correct');
        } else {
            assert.ok(!command, 'Found a command, but expecting to find none');
            return;
        }

        if (expectedCommand && expectedCommand.firstErrorText) {
            assert.equal((command.errors || []).length > 0, true, 'Expected at least one error');
            assert.equal(
                nonNullProp(command, 'errors')[0].message,
                expectedCommand.firstErrorText,
                'First error text was incorrect',
            );
        } else {
            assert.equal((command.errors || []).length, 0, 'Expected no errors');
        }
    }

    testCore(text);

    // Test again with LF changed to CR/LF
    const crlfText = text.replace(/\n/g, '\r\n');
    testCore(crlfText);

    // Test again with LF changed to multiple CR/LF
    const crlf2Text = text.replace(/\n/g, '\r\n\r\n');
    testCore(crlf2Text);

    // Test again with LF changed to CR
    const lfText = text.replace(/\n/g, '\r');
    testCore(lfText);

    // Test again with LF changed to tab
    const tabText = text.replace(/\n/g, '\t');
    testCore(tabText);

    // Test again with LF changed to space
    const spaceText = text.replace(/\n/g, ' ');
    testCore(spaceText);
}

function wrapInQuotes(word: string, numQuotes: number): string {
    //0 to do nothing, 1 for single quotes, 2 for double quotes
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

suite('scrapbook parsing Tests', () => {
    test('find', () => {
        const text = 'db.find()';
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.equal(command.text, text);
    });

    test('find with semicolon', () => {
        const text = 'db.find();';
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.equal(command.text, text);
    });

    test('first of two commands, Mac/Linux', () => {
        const line1 = 'db.find()';
        const line2 = "db.insertOne({'a': 'b'})";
        const text = `${line1}\n${line2}`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.equal(command.text, line1);
    });

    test('second of two commands, Mac/Linux', () => {
        const line1 = 'db.find()';
        for (let q = 0; q <= 2; q++) {
            const line2 = `db.insertOne({${wrapInQuotes('a', q)}:'b'})`;
            const text = `${line1}\n${line2}`;
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(2, 0));
            assert.equal(command.text, line2);
        }
    });

    test('second of two commands, Mac/Linux, semicolon', () => {
        const line1 = 'db.find();';
        for (let q = 0; q <= 2; q++) {
            const line2 = `db.insertOne({${wrapInQuotes('a', q)}:'b'})`;
            const text = `${line1}\n${line2}`;
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(2, 0));
            assert.equal(command.text, line2);
        }
    });

    test('first of two commands, Windows', () => {
        const line1 = 'db.find()';
        const line2 = "db.insertOne({'a': 'b'})";
        const text = `${line1}\r\n${line2}`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.equal(command.text, line1);
    });

    test('second of two commands, Windows', () => {
        const line1 = 'db.find()';
        const line2 = "db.insertOne({'a':'b'})";
        const text = `${line1}\r\n${line2}`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(2, 0));
        assert.equal(command.text, line2);
    });

    test('second of two commands, lots of blank lines, Windows', () => {
        const line1 = 'db.find()';
        const line2 = "db.insertOne({'a':'b'})";
        const text = `\r\n\r\n\r\n\r\n\r\n\r\n${line1}\r\n\r\n\r\n\r\n\r\n\r\n${line2}\r\n\r\n\r\n\r\n\r\n\r\n`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(5, 0));
        assert.equal(command.text, line2);
    });

    test('first of two commands, Windows, on blank line before second command', () => {
        const line1 = 'db.find()';
        for (let q = 0; q <= 2; q++) {
            const line2 = `db.insertOne({${wrapInQuotes('a', q)}:1})`;
            const text = `${line1}\r\n\r\n\r\n${line2}`;
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(2, 0));
            assert.equal(command.text, line1);
        }
    });

    test('drop', () => {
        testParse(`db.test.drop()`, { collection: 'test', name: 'drop', args: [] });
    });

    test('find, with empty object argument', () => {
        testParse(`db.test.find({})`, { collection: 'test', name: 'find', args: [{}] });
    });

    test('end-of-line comment', () => {
        testParse(`db.test.drop() // Ignore error "ns not found", it means "test" does not exist yet`, {
            collection: 'test',
            name: 'drop',
            args: [],
        });
    });

    test('multi-line insert from #214', () => {
        for (let q = 0; q <= 2; q++) {
            testParse(
                `db.heroes.insert({\n${wrapInQuotes('id', q)}: 2,\r\n${wrapInQuotes('name', q)}: "Batman",\r\n\r\n${wrapInQuotes('saying', q)}: "I'm Batman"\r})`,
                {
                    collection: 'heroes',
                    name: 'insert',
                    args: [
                        {
                            id: 2,
                            name: 'Batman',
                            saying: "I'm Batman",
                        },
                    ],
                },
            );
        }
    });

    test('find/project from #214', () => {
        testParse(`db.heroes.find({ "id": 2 }, { "saying": 1 })`, {
            collection: 'heroes',
            name: 'find',
            args: [
                {
                    id: 2,
                },
                {
                    saying: 1,
                },
            ],
        });
    });

    test('extraneous input', () => {
        testParse(
            `db.heros.find();
            hello there`,
            {
                collection: 'heros',
                name: 'find',
                args: [],
                firstErrorText:
                    "mismatched input 'hello' expecting {<EOF>, SingleLineComment, MultiLineComment, ';', 'db'}",
            },
        );
    });

    test('empty', () => {
        testParse('// hello there', undefined);
    });

    test('no command found, errors (will be tacked on to a blank command)', () => {
        testParse('hello there', {
            collection: undefined,
            name: undefined,
            args: undefined,
            firstErrorText:
                "mismatched input 'hello' expecting {<EOF>, SingleLineComment, MultiLineComment, ';', 'db'}",
        });
    });

    test('expect error: missing comma in arguments', () => {
        testParse(`db.heroes.find({ "id": 2 } { "saying": 1 })`, {
            collection: 'heroes',
            name: 'find',
            args: [
                {
                    id: 2,
                },
            ],
            firstErrorText: "mismatched input '{' expecting {',', ')'}",
        });

        testParse(`db.c.find({"a":[1,2,3]"b":1});`, {
            collection: 'c',
            name: 'find',
            args: [{ a: [1, 2, 3] }],
            firstErrorText: "mismatched input '\"b\"' expecting {',', '}'}",
        });
    });

    //https://github.com/Microsoft/vscode-cosmosdb/issues/467
    test('single quoted property names', () => {
        testParse(`db.heroes.find({ 'id': 2 }, { 'saying': 1 })`, {
            collection: 'heroes',
            name: 'find',
            args: [
                {
                    id: 2,
                },
                {
                    saying: 1,
                },
            ],
        });
    });
    test('expect error: missing function name', () => {
        // From https://github.com/Microsoft/vscode-cosmosdb/issues/659
        testParse(`db.c1.`, {
            collection: 'c1',
            name: '',
            args: [],
            firstErrorText: "mismatched input '<EOF>' expecting IDENTIFIER",
        });

        testParse(`db.c1.;`, {
            collection: 'c1',
            name: '',
            args: [],
            firstErrorText: "mismatched input ';' expecting IDENTIFIER",
        });

        testParse(`db.c1.(1, "a");`, {
            collection: 'c1',
            name: '<missing IDENTIFIER>',
            args: [1, 'a'],
            firstErrorText: "missing IDENTIFIER at '('",
        });

        testParse(`..(1, "a");`, {
            collection: undefined,
            name: undefined,
            args: undefined,
            firstErrorText: "mismatched input '.' expecting {<EOF>, SingleLineComment, MultiLineComment, ';', 'db'}",
        });

        // Just make sure doesn't throw
        expectSingleCommand(`db..(1, "a");`);
        expectSingleCommand(`..c1(1, "a");`);
    });

    test('multi-line insert from #214', () => {
        testParse(`db.heroes.insert({\n"id": 2,\r\n"name": "Batman",\r\n\r\n"saying": "I'm Batman"\r})`, {
            collection: 'heroes',
            name: 'insert',
            args: [
                {
                    id: 2,
                    name: 'Batman',
                    saying: "I'm Batman",
                },
            ],
        });
    });

    test('Array followed by } on separate line, from #73', () => {
        testParse(
            `db.createUser({
                "user": "buddhi",
                "pwd": "123",
                "roles": ["readWrite", "dbAdmin"]
                }
            )`,
            {
                collection: undefined,
                name: 'createUser',
                args: [
                    {
                        user: 'buddhi',
                        pwd: '123',
                        roles: ['readWrite', 'dbAdmin'],
                    },
                ],
            },
        );
    });

    test('Multiple line arrays, from #489', () => {
        testParse(
            `
            db.c2.insertMany([
                {"name": "Stephen", "age": 38, "male": true},
                {"name": "Stephen", "age": 38, "male": true}
                ])
            `,
            {
                collection: 'c2',
                name: 'insertMany',
                args: [
                    [
                        {
                            name: 'Stephen',
                            age: 38,
                            male: true,
                        },
                        {
                            name: 'Stephen',
                            age: 38,
                            male: true,
                        },
                    ],
                ],
            },
        );
    });

    test('test function call that has 2 arguments', () => {
        const arg0 = `{"Age": 31}`;
        const arg1 = `{"Name": true}`;
        const text = `db.find(${arg0}\r\n,\r\n\r\n${arg1})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(JSON.parse(command.arguments![0]), JSON.parse(arg0));
        assert.deepEqual(JSON.parse(command.arguments![1]), JSON.parse(arg1));
    });
    test('test function call with nested parameters - documents in an array', () => {
        const arg0 = `[{"name": "a"}, {"name": "b"}, {"name": "c"}]`;
        const arg1 = `{"ordered": true}`;
        const text = `db.test1.insertMany(${arg0},\r\n\r\n\r\n${arg1})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(JSON.parse(command.arguments![0]), JSON.parse(arg0));
        assert.deepEqual(JSON.parse(command.arguments![1]), JSON.parse(arg1));
    });
    test('test function call that has a nested parameter', () => {
        const arg0 = `{"name": {"First" : "a", "Last":"b"} }`;
        const text = `db.test1.insertMany(${arg0})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(JSON.parse(command.arguments![0]), JSON.parse(arg0));
    });
    test('test function call with erroneous syntax: missing comma', () => {
        const arg0 = `{"name": {"First" : "a", "Last":"b"} }`;
        const arg1 = `{"ordered": true}`;
        const text = `db.test1.insertMany(${arg0}   ${arg1})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const err = nonNullProp(command, 'errors')[0];
        assert.deepEqual(err.message, "mismatched input '{' expecting {',', ')'}");
        assert.deepEqual(err.range.start.line, 0);
        assert.deepEqual(err.range.start.character, 61);
    });
    test('test function call with erroneous syntax: missing comma, parameters separated with newline', () => {
        const arg0 = `{"name": {"First" : "a", "Last":"b"} }`;
        const arg1 = `{"ordered": \ntrue}`;
        const text = `db.test1.insertMany(${arg0} \n  ${arg1})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const err = nonNullProp(command, 'errors')[0];
        assert.deepEqual(err.message, "mismatched input '{' expecting {',', ')'}");
        assert.deepEqual(err.range.start.line, 1);
        assert.deepEqual(err.range.start.character, 2);
    });
    test('test function call with erroneous syntax: missing double quote', () => {
        const text = `db.test1.insertMany({name": {"First" : "a", "Last":"b"} })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const err = nonNullProp(command, 'errors')[0];
        assert.deepEqual(err.message, "missing ':' at '\": {\"'");
        assert.deepEqual(err.range.start.line, 0);
        assert.deepEqual(err.range.start.character, 25);
    });
    test('test function call with erroneous syntax: missing opening brace', () => {
        const text = `db.test1.insertMany("name": {"First" : "a", "Last":"b"} })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const err = nonNullProp(command, 'errors')[0];
        assert.deepEqual(err.message, "mismatched input ':' expecting {',', ')'}");
        assert.deepEqual(err.range.start.line, 0);
        assert.deepEqual(err.range.start.character, 26);
    });

    test('Chained command: to use pretty()', () => {
        testParse('db.timesheets.find().pretty();', {
            collection: 'timesheets',
            name: 'pretty',
            args: [],
        });
    });

    test('ISODate with standard date string', () => {
        testParse(
            'db.c1.insertOne({ "_id": ObjectId("5aecf1a63d8af732f07e4275"), "name": "Stephen", "date": ISODate("2018-05-01T00:00:00Z") });',
            {
                collection: 'c1',
                name: 'insertOne',
                args: [
                    {
                        _id: {
                            $oid: '5aecf1a63d8af732f07e4275',
                        },
                        date: {
                            $date: '2018-05-01T00:00:00.000Z',
                        },
                        name: 'Stephen',
                    },
                ],
            },
        );
    });

    test('ISODate without Z in date string', () => {
        testParse(
            'db.c1.insertOne({ "_id": ObjectId("5aecf1a63d8af732f07e4275"), "name": "Stephen", "date": ISODate("2018-05-01T00:00:00") });',
            {
                collection: 'c1',
                name: 'insertOne',
                args: [
                    {
                        _id: {
                            $oid: '5aecf1a63d8af732f07e4275',
                        },
                        date: {
                            $date: '2018-05-01T00:00:00.000Z',
                        },
                        name: 'Stephen',
                    },
                ],
            },
        );
    });

    test('Invalid ISODate', () => {
        testParse(
            'db.c1.insertOne({ "_id": ObjectId("5aecf1a63d8af732f07e4275"), "name": "Stephen", "date": ISODate("2018-05-01T00:00:00z") });',
            {
                collection: 'c1',
                name: 'insertOne',
                args: [],
                firstErrorText: 'Invalid time value',
            },
        );
    });

    test('Date', () => {
        const date: Date = new Date('2018-05-01T00:00:00');
        testParse(
            `db.c1.insertOne({ "_id": ObjectId("5aecf1a63d8af732f07e4275"), "name": "Stephen", "date": Date("${date.toUTCString()}") });`,
            {
                collection: 'c1',
                name: 'insertOne',
                args: [
                    {
                        _id: {
                            $oid: '5aecf1a63d8af732f07e4275',
                        },
                        date: {
                            $date: date.toString(),
                        },
                        name: 'Stephen',
                    },
                ],
            },
        );
    });

    test('Keys with periods', () => {
        testParse(
            `db.timesheets.update( {
            "year":"2018",
            "month":"06"
            },{
            "$set":{
            "workers.0.days.0.something":"yupy!"
            }
            });
        `,
            {
                collection: 'timesheets',
                name: 'update',
                args: [
                    {
                        year: 2018,
                        month: '06',
                    },
                    {
                        $set: {
                            'workers.0.days.0.something': 'yupy!',
                        },
                    },
                ],
            },
        );
    });

    test('nested objects', () => {
        testParse(
            `db.users.update({},{
            "$pull":{
            "proposals":{
            "$elemMatch":{"_id":"4qsBHLDCb755c3vPH"}
            }
            }
            })`,
            {
                collection: 'users',
                name: 'update',
                args: [
                    {},
                    {
                        $pull: {
                            proposals: {
                                $elemMatch: {
                                    _id: '4qsBHLDCb755c3vPH',
                                },
                            },
                        },
                    },
                ],
            },
        );
    });
    test('test function call with and without quotes', () => {
        for (let q = 0; q <= 2; q++) {
            const text = `db.test1.insertMany({${wrapInQuotes('name', q)}: 'First' })`;
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
            assert.deepEqual(command.argumentObjects, [{ name: 'First' }]);
        }
    });
    test('test function call with numbers', () => {
        const text = `db.test1.insertMany({'name': 1010101})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: 1010101 }]);
    });
    test('test function call boolean', () => {
        const text = `db.test1.insertMany({'name': false})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: false }]);
    });
    test('test function call token inside quotes', () => {
        const text = `db.test1.insertMany({'name': 'false'})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: 'false' }]);
    });
    test('test function call with an empty string property value', () => {
        const text = `db.test1.insertMany({'name': ''})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: '' }]);
    });
    test('test function call with array and multiple arguments', () => {
        const text = `db.test1.find({'roles': ['readWrite', 'dbAdmin']}, {'resources': ['secondary', 'primary']})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [
            { roles: ['readWrite', 'dbAdmin'] },
            { resources: ['secondary', 'primary'] },
        ]);
    });
    test('test function call with nested objects', () => {
        const text = `db.test1.find({'roles': [{'optional': 'yes'}]}, {'resources': ['secondary', 'primary']})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [
            { roles: [{ optional: 'yes' }] },
            { resources: ['secondary', 'primary'] },
        ]);
    });

    test('test incomplete function call - replicate user typing - no function call yet', () => {
        const text = `db.test1.`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, []);
        assert.deepEqual(command.collection, 'test1');
    });

    test('test incomplete function call - replicate user typing - missing propertyValue', () => {
        const text = `db.test1.find({"name": {"First" : } })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: { First: {} } }]);
    });

    test('test incomplete function call - replicate user typing - missing colon & propertyValue', () => {
        const text = `db.test1.find({"name": {"First"  } })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ name: { First: {} } }]);
    });

    test('test incomplete function call - replicate user typing - empty array as argument', () => {
        const text = `db.heroes.aggregate([\n])`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [[]]);
    });

    test('test quotes inside a string - 1', () => {
        const text = `db.test1.find("That's all")`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, ["That's all"]);
    });

    test('test quotes inside a string - 2', () => {
        const text = `db.test1.find('That"s all')`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, ['That"s all']);
    });

    // Note: when escaping a character, escape it twice.
    test('test quotes inside a string - 3', () => {
        const text = `db.test1.find("Hello \\"there\\"")`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, ['Hello \\"there\\"']);
    });

    test('test quotes inside a string - 4', () => {
        const text = `db.test1.find('Hello \\'there\\'')`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, ["Hello \\'there\\'"]);
    });

    test('test nested property names (has dots in the name)', () => {
        const text = `db.test1.find({"name.FirstName": 1})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.argumentObjects, [{ 'name.FirstName': 1 }]);
    });

    test('test managed namespace collection names (has dots in the name)', () => {
        const text = `db.test1.beep.find({})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.collection, 'test1.beep');
    });

    test('test aggregate query', () => {
        for (let q = 0; q <= 2; q++) {
            const text = `db.orders.aggregate([
                { ${wrapInQuotes('$match', q)}: { ${wrapInQuotes('status', q)} : "A" } },
                { ${wrapInQuotes('$group', q)}: { ${wrapInQuotes('_id', q)}: "$cust_id", ${wrapInQuotes('total', q)}: { ${wrapInQuotes('$sum', q)}: "$amount" } } },
                { ${wrapInQuotes('$sort', q)}: { ${wrapInQuotes('total', q)}: -1 } }
                ],
                {
                    ${wrapInQuotes('cursor', q)}: { ${wrapInQuotes('batchSize', q)}: 0 }
                })`;
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
            assert.deepEqual(command.collection, 'orders');
            assert.deepEqual(command.argumentObjects, [
                [
                    { $match: { status: 'A' } },
                    { $group: { _id: '$cust_id', total: { $sum: '$amount' } } },
                    { $sort: { total: -1 } },
                ],
                {
                    cursor: { batchSize: 0 },
                },
            ]);
        }
    });

    test('test ObjectID - no parameter', () => {
        const text = `db.c1.insert({"name": ObjectId()})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.collection, 'c1');
        assert.ok((<any>nonNullProp(command, 'argumentObjects')[0]).name instanceof ObjectId);
    });

    test('test ObjectID - hex', () => {
        const idParam = 'abcdef123456789012345678';
        const text = `db.c1.insert({"name": ObjectId("${idParam}")})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.collection, 'c1');
        const id = new ObjectId(idParam);
        assert.deepEqual(command.argumentObjects, [{ name: id }]);
    });

    test('test faulty ObjectID - hex - extra characters', () => {
        const idParam = 'abcdef12345678901234567890';
        const text = `db.c1.insert({"name": ObjectId("${idParam}")})`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.collection, 'c1');
        assert.deepEqual(command.argumentObjects, [{ name: {} }]);
        assert.notStrictEqual(nonNullProp(command, 'errors')[0]?.message, undefined);
    });

    test('test faulty ObjectID - hex - fewer characters', () => {
        const idParam = 'abcdef123456789012345';
        for (let i = 1; i < 3; i++) {
            const text = `db.c1.insert({"name": ObjectId(${wrapInQuotes(idParam, i)})})`;
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
            assert.deepEqual(command.collection, 'c1');
            assert.deepEqual(command.argumentObjects, [{ name: {} }]);
            assert.notStrictEqual(nonNullProp(command, 'errors')[0]?.message, undefined);
        }
    });
    //Examples inspired from https://docs.mongodb.com/manual/reference/operator/query/regex/
    test('test regular expressions - only pattern, no flags', () => {
        const text = `db.test1.beep.find({ sku:  /789$/ })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, '789$');
    });

    test('test regular expressions - pattern and flags', () => {
        const text = `db.test1.beep.find({ sku:  /789$/i } )`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        console.log('generatedRegExp', generatedRegExp);
        assert.deepEqual(generatedRegExp.options, 'i');
        assert.deepEqual(generatedRegExp.pattern, '789$');
    });

    test('test regular expressions - Intellisense - flag contains unsupported option', () => {
        const text = `db.test1.beep.find({ sku: /789$/g  })`;
        try {
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            findCommandAtPosition(commands, new Position(0, 0));
        } catch (error) {
            const err = parseError(error);
            assert.deepEqual('Unexpected node encountered', err.message);
        }
    });

    test('test regular expressions - Intellisense - flag contains invalid option', () => {
        const text = `db.test1.beep.find({ sku: /789$/q  })`;
        try {
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            findCommandAtPosition(commands, new Position(0, 0));
        } catch (error) {
            const err = parseError(error);
            assert.deepEqual('Unexpected node encountered', err.message);
        }
    });

    test('test regular expressions - wrong escape - throw error', () => {
        const text = `db.test1.beep.find({ sku:  /789$\\/b\\/q })`;
        try {
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            findCommandAtPosition(commands, new Position(0, 0));
        } catch (error) {
            assert.equal(error.message, 'Invalid regular expression: /789$\\/b\\/: \\ at end of pattern');
        }
    });

    //Passing the following test should imply the rest of the tests pass too.
    // The regex parsing tests following this test should help zero-in on which case isn't handled properly.
    test('test regular expression parsing - with many special cases', () => {
        const text = `db.test1.beep.find({ sku:  /^(hello?= world).*[^0-9]+|(world\\b\\*){0,2}$/ })`;
        console.log(text);
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        console.log('commands', commands);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        console.log('command', command);
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, '^(hello?= world).*[^0-9]+|(world\\b\\*){0,2}$');
    });

    test('test regular expression parsing EJSON syntax - with many special cases', () => {
        const text = `db.test1.beep.find({ sku:  {$regex: "^(hello?= world).*[^0-9]+|(world\\\\b\\\\*){0,2}$"} })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, '^(hello?= world).*[^0-9]+|(world\\b\\*){0,2}$');
    });

    test('test regular expression parsing interoperability', () => {
        const text1 = `db.test1.beep.find({ sku:  /^(hello?= world).*[^0-9]+|(world\\b\\*){0,2}$/ })`;
        const commands1: MongoCommand[] = getAllCommandsFromText(text1);
        const command1: MongoCommand = findCommandAtPosition(commands1, new Position(0, 0));
        const generatedRegExp1 = (<any>nonNullProp(command1, 'argumentObjects')[0]).sku;
        const text2 = `db.test1.beep.find({ sku:  {$regex: "^(hello?= world).*[^0-9]+|(world\\\\b\\\\*){0,2}$"} })`;
        const commands2: MongoCommand[] = getAllCommandsFromText(text2);
        const command2: MongoCommand = findCommandAtPosition(commands2, new Position(0, 0));
        const generatedRegExp2 = (<any>nonNullProp(command2, 'argumentObjects')[0]).sku;
        assert.deepEqual(
            [generatedRegExp1.options, generatedRegExp1.pattern],
            ['', '^(hello?= world).*[^0-9]+|(world\\b\\*){0,2}$'],
        );
        assert.deepEqual(
            [generatedRegExp2.options, generatedRegExp2.pattern],
            ['', '^(hello?= world).*[^0-9]+|(world\\b\\*){0,2}$'],
        );
    });

    test('test regular expression parsing interoperability - word break', () => {
        const text1 = `db.test1.beep.find({ sku:  /ker\\b/ })`; // equivalent to user typing out /ker\b/
        const commands1: MongoCommand[] = getAllCommandsFromText(text1);
        const command1: MongoCommand = findCommandAtPosition(commands1, new Position(0, 0));
        const generatedRegExp1 = (<any>nonNullProp(command1, 'argumentObjects')[0]).sku;
        const text2 = `db.test1.beep.find({ sku:  {$regex: "ker\\\\b"} })`;
        const commands2: MongoCommand[] = getAllCommandsFromText(text2);
        const command2: MongoCommand = findCommandAtPosition(commands2, new Position(0, 0));
        const generatedRegExp2 = (<any>nonNullProp(command2, 'argumentObjects')[0]).sku;
        assert.deepEqual([generatedRegExp1.options, generatedRegExp1.pattern], ['', 'ker\\b']);
        assert.deepEqual([generatedRegExp2.options, generatedRegExp2.pattern], ['', 'ker\\b']);
    });

    test('test regular expression parsing interoperability - newline', () => {
        const text1 = `db.test1.beep.find({ sku:  /ker\\n/ })`; // equivalent to user typing out /ker\n/
        const commands1: MongoCommand[] = getAllCommandsFromText(text1);
        const command1: MongoCommand = findCommandAtPosition(commands1, new Position(0, 0));
        const generatedRegExp1 = (<any>nonNullProp(command1, 'argumentObjects')[0]).sku;
        const text2 = `db.test1.beep.find({ sku:  {$regex: "ker\\\\n"} })`;
        const commands2: MongoCommand[] = getAllCommandsFromText(text2);
        const command2: MongoCommand = findCommandAtPosition(commands2, new Position(0, 0));
        const generatedRegExp2 = (<any>nonNullProp(command2, 'argumentObjects')[0]).sku;
        assert.deepEqual([generatedRegExp2.options, generatedRegExp2.pattern], ['', 'ker\\n']);
        assert.deepEqual([generatedRegExp1.options, generatedRegExp1.pattern], ['', 'ker\\n']);
    });
    test('test regular expression parsing interoperability - carriage return', () => {
        const text1 = `db.test1.beep.find({ sku:  /ker\\r/ })`; // equivalent to user typing out /ker\r/
        const commands1: MongoCommand[] = getAllCommandsFromText(text1);
        const command1: MongoCommand = findCommandAtPosition(commands1, new Position(0, 0));
        const generatedRegExp1 = (<any>nonNullProp(command1, 'argumentObjects')[0]).sku;
        const text2 = `db.test1.beep.find({ sku:  {$regex: "ker\\\\r"} })`;
        const commands2: MongoCommand[] = getAllCommandsFromText(text2);
        const command2: MongoCommand = findCommandAtPosition(commands2, new Position(0, 0));
        const generatedRegExp2 = (<any>nonNullProp(command2, 'argumentObjects')[0]).sku;
        assert.deepEqual([generatedRegExp1.options, generatedRegExp1.pattern], ['', 'ker\\r']);
        assert.deepEqual([generatedRegExp2.options, generatedRegExp2.pattern], ['', 'ker\\r']);
    });

    test('test regular expressions - only pattern, no flags', () => {
        const text = `db.test1.beep.find({ sku: { $regex: "789$" } })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, '789$');
    });

    test('test regular expressions - pattern and flags', () => {
        const text = `db.test1.beep.find({ sku: { $regex: "789$", $options:"i" } })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, 'i');
        assert.deepEqual(generatedRegExp.pattern, '789$');
    });

    test('test regular expressions - Intellisense - flag contains invalid option', () => {
        const text = `db.test1.beep.find({ sku: { $regex: "789$", $options:"q" } })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.notStrictEqual(nonNullProp(command, 'errors')[0]?.message, undefined);
        assert.deepEqual(nonNullProp(command, 'errors')[0].range.start.character, 19);
    });

    test('test regular expression parsing - with groupings', () => {
        const text = `db.test1.beep.find({ sku:  /(?:hello)\\3/ })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, '(?:hello)\\3');
    });

    test('test regular expression parsing - with special characters', () => {
        const text = `db.test1.beep.find({ sku: /(hello)*(world)?(name)+./ })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, '(hello)*(world)?(name)+.');
    });

    test('test regular expression parsing - with boundaries', () => {
        const text = `db.test1.beep.find({ sku: /^(hello world)[^0-9]|(world\\b)$/ })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, '^(hello world)[^0-9]|(world\\b)$');
    });

    test('test regular expression parsing - with quantifiers', () => {
        const text = `db.test1.beep.find({ sku: /(hello)*[^0-9]+|(world){0,2}./ })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, '(hello)*[^0-9]+|(world){0,2}.');
    });

    test('test regular expression parsing - with conditional', () => {
        const text = `db.test1.beep.find({ sku:  /(hello?= world)|(world)/ })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, '(hello?= world)|(world)');
    });

    test('test regular expression parsing - with escaped special characters', () => {
        const text = `db.test1.beep.find({ sku:  /world\\*\\.\\?\\+/ })`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        const generatedRegExp = (<any>nonNullProp(command, 'argumentObjects')[0]).sku;
        assert.deepEqual(generatedRegExp.options, '');
        assert.deepEqual(generatedRegExp.pattern, 'world\\*\\.\\?\\+');
    });

    test('test chained command: argument aggregation', () => {
        testParse('db.timesheets.find({name: "Andy", surname: "Jackson"}).pretty();', {
            collection: 'timesheets',
            name: 'pretty',
            args: [{ name: 'Andy', surname: 'Jackson' }],
        });
    });

    test('Chained command - order of parsed arguments', () => {
        testParse('db.timesheets.find({name:"Andy"}).sort({age: 1}).skip(40);', {
            collection: 'timesheets',
            name: 'skip',
            args: [{ name: 'Andy' }, { age: 1 }, 40],
        });
    });

    test('Chained command - missing period', () => {
        testParse('db.timesheets.find({name:"Andy"}).sort({age: 1})skip(40);', {
            collection: 'timesheets',
            name: 'sort',
            args: [{ name: 'Andy' }, { age: 1 }],
            firstErrorText:
                "mismatched input 'skip' expecting {<EOF>, SingleLineComment, MultiLineComment, ';', '.', 'db'}",
        });
    });

    test('Chained command - mid-type - missing bracket', () => {
        testParse('db.timesheets.find({name:"Andy"}).sort', {
            collection: 'timesheets',
            name: 'sort',
            args: [{ name: 'Andy' }],
            firstErrorText: "mismatched input '<EOF>' expecting '('",
        });
    });

    test('Chained command - mid-type - typed the dot, but not the function call', () => {
        testParse('db.timesheets.find({name:"Andy"}).', {
            collection: 'timesheets',
            name: '',
            args: [{ name: 'Andy' }],
            firstErrorText: "mismatched input '<EOF>' expecting IDENTIFIER",
        });
    });

    //TODO: Tests to simulate cases where the user hasn't completed typing

    test('test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/688', () => {
        for (let q = 0; q <= 2; q++) {
            const text = `db.hdr.aggregate([
                { ${wrapInQuotes('$match', q)}: { "CURRENCY_ID": "USD" } },
              ])`; //Note the trailing comma. There should be 1 argument object returned, an array, that has 2 elements
            //one expected, and another empty object.
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
            assert.deepEqual(command.collection, 'hdr');
            assert.deepEqual(command.argumentObjects, [[{ $match: { CURRENCY_ID: 'USD' } }, {}]]);
        }
    });

    test('Chained command- test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/785', () => {
        testParse('db.timesheets.find({name:"Andy"}).count();', {
            collection: 'timesheets',
            name: 'count',
            args: [{ name: 'Andy' }],
        });
    });

    test('Chained command- test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/795', () => {
        testParse('db.timesheets.find({}).limit(10);', {
            collection: 'timesheets',
            name: 'limit',
            args: [{}, 10],
        });
    });

    test('Chained command alternative for rs.slaveOk()- test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/565', () => {
        testParse('db.getMongo().setSlaveOk();', {
            collection: '',
            name: 'setSlaveOk',
            args: [],
        });
    });

    test('Multiple line command, from #489', () => {
        testParse(
            `
        db.finalists.find({name: "Jefferson"})
        .
        limit
        (10);
        `,
            {
                collection: 'finalists',
                name: 'limit',
                args: [
                    {
                        name: 'Jefferson',
                    },
                    10,
                ],
            },
        );
    });

    test('test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/703', () => {
        for (let q = 0; q <= 2; q++) {
            const text = `db.Users.find({ ${wrapInQuotes('user', q)}: { ${wrapInQuotes('$in', q)}: [ "A80", "HPA" ] } },{ ${wrapInQuotes('_id', q)}: false });`;
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
            assert.deepEqual(command.collection, 'Users');
            assert.deepEqual(command.argumentObjects, [{ user: { $in: ['A80', 'HPA'] } }, { _id: false }]);
        }
    });

    test('test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/691', () => {
        for (let q = 0; q <= 2; q++) {
            const text = `db.users.aggregate([
                { ${wrapInQuotes('$match', q)}: {${wrapInQuotes('_id', q)}: {"$oid" :"5b23d2ba92b52cf794bdeb9c")}}},
                { ${wrapInQuotes('$project', q)}: {
                    ${wrapInQuotes('scores', q)}: {${wrapInQuotes('$filter', q)}: {
                        ${wrapInQuotes('input', q)}: '$scores',
                        ${wrapInQuotes('as', q)}: 'score',
                        ${wrapInQuotes('cond', q)}: {${wrapInQuotes('$gt', q)}: ['$$score', 3]}
                    }}
                }}
            ])`;
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
            assert.deepEqual(command.collection, 'users');
            assert.deepEqual(nonNullProp(command, 'argumentObjects')[0][0], {
                $match: { _id: new ObjectId('5b23d2ba92b52cf794bdeb9c') },
            });
            assert.deepEqual(nonNullProp(command, 'argumentObjects')[0][1], {
                $project: {
                    scores: {
                        $filter: {
                            input: '$scores',
                            as: 'score',
                            cond: { $gt: ['$$score', 3] },
                        },
                    },
                },
            });
        }
    });

    test('test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/717', () => {
        for (let q = 0; q <= 2; q++) {
            const text = `db.Users.find({${wrapInQuotes('age', q)} : { ${wrapInQuotes('$in', q)} : [19, 20, 22, 25]}});`;
            const commands: MongoCommand[] = getAllCommandsFromText(text);
            const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
            assert.deepEqual(command.collection, 'Users');
            assert.deepEqual(command.argumentObjects, [{ age: { $in: [19, 20, 22, 25] } }]);
        }
    });

    test('test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/737', () => {
        const text = `db.c1.insert({},f)`;
        const commands: MongoCommand[] = getAllCommandsFromText(text);
        const command: MongoCommand = findCommandAtPosition(commands, new Position(0, 0));
        assert.deepEqual(command.collection, 'c1');
        assert.deepEqual(command.argumentObjects, [{}, {}]);
        assert.deepEqual(
            nonNullProp(command, 'errors')[0].message,
            "mismatched input 'f' expecting {'{', '[', RegexLiteral, StringLiteral, 'null', BooleanLiteral, NumericLiteral}",
        );
    });

    test('test user issues: https://github.com/Microsoft/vscode-cosmosdb/issues/899 - multi-line comment, not regex', () => {
        for (const escape of ['\n', '\r', '\n\r', '\r\n']) {
            const text = `db.heroes.count()${escape}/*db.c2.insertMany([${escape}{"name": "Stephen", "age": 38, "male": true},${escape}{"name": "Stephen", "age": 38, "male": true}${escape}]);${escape}*/${escape}${escape}db.heroes.find();`;
            const commands = getAllCommandsFromText(text);
            assert.equal(commands.length, 2, `Error in parsing ${text}`);
            assert.equal(commands[0].name, 'count');
            assert.equal(commands[1].name, 'find');
        }
    });
});
