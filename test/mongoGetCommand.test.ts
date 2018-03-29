/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';
import { MongoCommands } from '../src/mongo/commands';
import { Position } from 'vscode';

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
});
