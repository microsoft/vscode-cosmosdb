/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import { MongoCommands } from '../src/mongo/commands';
import { Position } from 'vscode';

function testParse(text: string, expected: { collection: string, name: string, args: object[] }) {
    let command = MongoCommands.getCommand(text, new Position(0, 0));

    assert.equal(command.collection, expected.collection, "Parsed collection name is not correct");
    assert.equal(command.name, expected.name, "Parsed command name is not correct");

    let actualArgs = (command.arguments || []).map(arg => JSON.parse(arg));
    assert.deepEqual(actualArgs, expected.args, "Parsed arguments are not correct");
}

suite("scrapbook parsing Tests", () => {
    test("find", () => {
        let text = "db.find()";
        let command = MongoCommands.getCommand(text, new Position(0, 0));
        assert.equal(command.text, text);
    });

    test("find with semicolon", () => {
        let text = "db.find();";
        let command = MongoCommands.getCommand(text, new Position(0, 0));
        assert.equal(command.text, text);
    });

    test("first of two commands, Mac/Linux", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a': 'b'})";
        let text = `${line1}\n${line2}`;
        let command = MongoCommands.getCommand(text, new Position(0, 0));
        assert.equal(command.text, line1);
    });

    test("second of two commands, Mac/Linux", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a':'b'})";
        let text = `${line1}\n${line2}`;
        let command = MongoCommands.getCommand(text, new Position(2, 0));
        assert.equal(command.text, line2);
    });

    test("second of two commands, Mac/Linux, semicolon", () => {
        let line1 = "db.find();";
        let line2 = "db.insertOne({'a':'b'})";
        let text = `${line1}\n${line2}`;
        let command = MongoCommands.getCommand(text, new Position(2, 0));
        assert.equal(command.text, line2);
    });

    test("first of two commands, Windows", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a': 'b'})";
        let text = `${line1}\r\n${line2}`;
        let command = MongoCommands.getCommand(text, new Position(0, 0));
        assert.equal(command.text, line1);
    });

    test("second of two commands, Windows", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a':'b'})";
        let text = `${line1}\r\n${line2}`;
        let command = MongoCommands.getCommand(text, new Position(2, 0));
        assert.equal(command.text, line2);
    });

    test("second of two commands, lots of blank lines, Windows", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a':'b'})";
        let text = `\r\n\r\n\r\n\r\n\r\n\r\n${line1}\r\n\r\n\r\n\r\n\r\n\r\n${line2}\r\n\r\n\r\n\r\n\r\n\r\n`;
        let command = MongoCommands.getCommand(text, new Position(5, 0));
        assert.equal(command.text, line2);
    });

    test("first of two commands, Windows, on blank line before second command", () => {
        let line1 = "db.find()";
        let line2 = "db.insertOne({'a': 'b'})";
        let text = `${line1}\r\n\r\n\r\n${line2}`;
        let command = MongoCommands.getCommand(text, new Position(2, 0));
        assert.equal(command.text, line1);
    });

    test("drop", () => {
        testParse(
            `db.test.drop()`,
            { collection: "test", name: "drop", args: [] });
    });

    test("end-of-line comment", () => {
        testParse(
            `db.test.drop() // Ignore error "ns not found", it means "test" does not exist yet`,
            { collection: "test", name: "drop", args: [] });
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

    // https://github.com/Microsoft/vscode-cosmosdb/issues/467
    // test("single quoted property names", () => {
    //     testParse(
    //         `db.heroes.find({ 'id': 2 }, { 'saying': 1 })`,
    //         {
    //             collection: "heroes", name: "find", args: [
    //                 {
    //                     id: 2
    //                 },
    //                 {
    //                     saying: 1
    //                 }
    //             ]
    //         });
    // });

    // https://github.com/Microsoft/vscode-cosmosdb/issues/466
    // test("Unquoted property names", () => {
    //     testParse(
    //         `db.heroes.find({ id: 2 }, { saying: 1 })`,
    //         {
    //             collection: "heroes", name: "find", args: [
    //                 {
    //                     id: 2
    //                 },
    //                 {
    //                     saying: 1
    //                 }
    //             ]
    //         });
    // });
});
