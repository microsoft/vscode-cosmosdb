/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Generated from ./grammar/mongo.g4 by ANTLR 4.6-SNAPSHOT

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is legacy code that we are not maintaining for Typescript 4
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import { ATN } from 'antlr4ts/atn/ATN';
import { ATNDeserializer } from 'antlr4ts/atn/ATNDeserializer';
import { ParserATNSimulator } from 'antlr4ts/atn/ParserATNSimulator';
import { NotNull, Override } from 'antlr4ts/Decorators';
import * as Utils from 'antlr4ts/misc/Utils';
import { NoViableAltException } from 'antlr4ts/NoViableAltException';
import { Parser } from 'antlr4ts/Parser';
import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { RecognitionException } from 'antlr4ts/RecognitionException';
import { RuleVersion } from 'antlr4ts/RuleVersion';
import { Token } from 'antlr4ts/Token';
import { type TokenStream } from 'antlr4ts/TokenStream';
import { type TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { type Vocabulary } from 'antlr4ts/Vocabulary';
import { VocabularyImpl } from 'antlr4ts/VocabularyImpl';
import { type mongoListener } from './mongoListener';
import { type mongoVisitor } from './mongoVisitor';

export class mongoParser extends Parser {
    public static readonly T__0 = 1;
    public static readonly T__1 = 2;
    public static readonly T__2 = 3;
    public static readonly T__3 = 4;
    public static readonly T__4 = 5;
    public static readonly T__5 = 6;
    public static readonly T__6 = 7;
    public static readonly T__7 = 8;
    public static readonly RegexLiteral = 9;
    public static readonly SingleLineComment = 10;
    public static readonly MultiLineComment = 11;
    public static readonly StringLiteral = 12;
    public static readonly NullLiteral = 13;
    public static readonly BooleanLiteral = 14;
    public static readonly NumericLiteral = 15;
    public static readonly DecimalLiteral = 16;
    public static readonly LineTerminator = 17;
    public static readonly SEMICOLON = 18;
    public static readonly DOT = 19;
    public static readonly DB = 20;
    public static readonly IDENTIFIER = 21;
    public static readonly DOUBLE_QUOTED_STRING_LITERAL = 22;
    public static readonly SINGLE_QUOTED_STRING_LITERAL = 23;
    public static readonly WHITESPACE = 24;
    public static readonly RULE_mongoCommands = 0;
    public static readonly RULE_commands = 1;
    public static readonly RULE_command = 2;
    public static readonly RULE_emptyCommand = 3;
    public static readonly RULE_collection = 4;
    public static readonly RULE_functionCall = 5;
    public static readonly RULE_arguments = 6;
    public static readonly RULE_argument = 7;
    public static readonly RULE_objectLiteral = 8;
    public static readonly RULE_arrayLiteral = 9;
    public static readonly RULE_elementList = 10;
    public static readonly RULE_propertyNameAndValueList = 11;
    public static readonly RULE_propertyAssignment = 12;
    public static readonly RULE_propertyValue = 13;
    public static readonly RULE_literal = 14;
    public static readonly RULE_propertyName = 15;
    public static readonly RULE_comment = 16;
    public static readonly ruleNames: string[] = [
        'mongoCommands',
        'commands',
        'command',
        'emptyCommand',
        'collection',
        'functionCall',
        'arguments',
        'argument',
        'objectLiteral',
        'arrayLiteral',
        'elementList',
        'propertyNameAndValueList',
        'propertyAssignment',
        'propertyValue',
        'literal',
        'propertyName',
        'comment',
    ];

    private static readonly _LITERAL_NAMES: (string | undefined)[] = [
        undefined,
        "'('",
        "','",
        "')'",
        "'{'",
        "'}'",
        "'['",
        "']'",
        "':'",
        undefined,
        undefined,
        undefined,
        undefined,
        "'null'",
        undefined,
        undefined,
        undefined,
        undefined,
        "';'",
        "'.'",
        "'db'",
    ];
    private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'RegexLiteral',
        'SingleLineComment',
        'MultiLineComment',
        'StringLiteral',
        'NullLiteral',
        'BooleanLiteral',
        'NumericLiteral',
        'DecimalLiteral',
        'LineTerminator',
        'SEMICOLON',
        'DOT',
        'DB',
        'IDENTIFIER',
        'DOUBLE_QUOTED_STRING_LITERAL',
        'SINGLE_QUOTED_STRING_LITERAL',
        'WHITESPACE',
    ];
    public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(
        mongoParser._LITERAL_NAMES,
        mongoParser._SYMBOLIC_NAMES,
        [],
    );

    @Override
    @NotNull
    public get vocabulary(): Vocabulary {
        return mongoParser.VOCABULARY;
    }

    @Override
    public get grammarFileName(): string {
        return 'mongo.g4';
    }

    @Override
    public get ruleNames(): string[] {
        return mongoParser.ruleNames;
    }

    @Override
    public get serializedATN(): string {
        return mongoParser._serializedATN;
    }

    constructor(input: TokenStream) {
        super(input);
        this._interp = new ParserATNSimulator(mongoParser._ATN, this);
    }
    @RuleVersion(0)
    public mongoCommands(): MongoCommandsContext {
        const _localctx: MongoCommandsContext = new MongoCommandsContext(this._ctx, this.state);
        this.enterRule(_localctx, 0, mongoParser.RULE_mongoCommands);
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 34;
                this.commands();
                this.state = 35;
                this.match(mongoParser.EOF);
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public commands(): CommandsContext {
        const _localctx: CommandsContext = new CommandsContext(this._ctx, this.state);
        this.enterRule(_localctx, 2, mongoParser.RULE_commands);
        let _la: number;
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 42;
                this._errHandler.sync(this);
                _la = this._input.LA(1);
                while (
                    (_la & ~0x1f) === 0 &&
                    ((1 << _la) &
                        ((1 << mongoParser.SingleLineComment) |
                            (1 << mongoParser.MultiLineComment) |
                            (1 << mongoParser.SEMICOLON) |
                            (1 << mongoParser.DB))) !==
                        0
                ) {
                    {
                        this.state = 40;
                        this._errHandler.sync(this);
                        switch (this._input.LA(1)) {
                            case mongoParser.DB:
                                {
                                    this.state = 37;
                                    this.command();
                                }
                                break;
                            case mongoParser.SEMICOLON:
                                {
                                    this.state = 38;
                                    this.emptyCommand();
                                }
                                break;
                            case mongoParser.SingleLineComment:
                            case mongoParser.MultiLineComment:
                                {
                                    this.state = 39;
                                    this.comment();
                                }
                                break;
                            default:
                                throw new NoViableAltException(this);
                        }
                    }
                    this.state = 44;
                    this._errHandler.sync(this);
                    _la = this._input.LA(1);
                }
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public command(): CommandContext {
        const _localctx: CommandContext = new CommandContext(this._ctx, this.state);
        this.enterRule(_localctx, 4, mongoParser.RULE_command);
        let _la: number;
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 45;
                this.match(mongoParser.DB);
                this.state = 48;
                this._errHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this._input, 2, this._ctx)) {
                    case 1:
                        {
                            this.state = 46;
                            this.match(mongoParser.DOT);
                            this.state = 47;
                            this.collection();
                        }
                        break;
                }
                this.state = 52;
                this._errHandler.sync(this);
                _la = this._input.LA(1);
                do {
                    {
                        {
                            this.state = 50;
                            this.match(mongoParser.DOT);
                            this.state = 51;
                            this.functionCall();
                        }
                    }
                    this.state = 54;
                    this._errHandler.sync(this);
                    _la = this._input.LA(1);
                } while (_la === mongoParser.DOT);
                this.state = 57;
                this._errHandler.sync(this);
                switch (this.interpreter.adaptivePredict(this._input, 4, this._ctx)) {
                    case 1:
                        {
                            this.state = 56;
                            this.match(mongoParser.SEMICOLON);
                        }
                        break;
                }
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public emptyCommand(): EmptyCommandContext {
        const _localctx: EmptyCommandContext = new EmptyCommandContext(this._ctx, this.state);
        this.enterRule(_localctx, 6, mongoParser.RULE_emptyCommand);
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 59;
                this.match(mongoParser.SEMICOLON);
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public collection(): CollectionContext {
        const _localctx: CollectionContext = new CollectionContext(this._ctx, this.state);
        this.enterRule(_localctx, 8, mongoParser.RULE_collection);
        try {
            let _alt: number;
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 61;
                this.match(mongoParser.IDENTIFIER);
                this.state = 66;
                this._errHandler.sync(this);
                _alt = this.interpreter.adaptivePredict(this._input, 5, this._ctx);
                while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
                    if (_alt === 1) {
                        {
                            {
                                this.state = 62;
                                this.match(mongoParser.DOT);
                                this.state = 63;
                                this.match(mongoParser.IDENTIFIER);
                            }
                        }
                    }
                    this.state = 68;
                    this._errHandler.sync(this);
                    _alt = this.interpreter.adaptivePredict(this._input, 5, this._ctx);
                }
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public functionCall(): FunctionCallContext {
        const _localctx: FunctionCallContext = new FunctionCallContext(this._ctx, this.state);
        this.enterRule(_localctx, 10, mongoParser.RULE_functionCall);
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 69;
                _localctx._FUNCTION_NAME = this.match(mongoParser.IDENTIFIER);
                this.state = 70;
                this.arguments();
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public arguments(): ArgumentsContext {
        const _localctx: ArgumentsContext = new ArgumentsContext(this._ctx, this.state);
        this.enterRule(_localctx, 12, mongoParser.RULE_arguments);
        let _la: number;
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 72;
                _localctx._OPEN_PARENTHESIS = this.match(mongoParser.T__0);
                this.state = 81;
                this._errHandler.sync(this);
                _la = this._input.LA(1);
                if (
                    (_la & ~0x1f) === 0 &&
                    ((1 << _la) &
                        ((1 << mongoParser.T__3) |
                            (1 << mongoParser.T__5) |
                            (1 << mongoParser.RegexLiteral) |
                            (1 << mongoParser.StringLiteral) |
                            (1 << mongoParser.NullLiteral) |
                            (1 << mongoParser.BooleanLiteral) |
                            (1 << mongoParser.NumericLiteral))) !==
                        0
                ) {
                    {
                        this.state = 73;
                        this.argument();
                        this.state = 78;
                        this._errHandler.sync(this);
                        _la = this._input.LA(1);
                        while (_la === mongoParser.T__1) {
                            {
                                {
                                    this.state = 74;
                                    this.match(mongoParser.T__1);
                                    this.state = 75;
                                    this.argument();
                                }
                            }
                            this.state = 80;
                            this._errHandler.sync(this);
                            _la = this._input.LA(1);
                        }
                    }
                }

                this.state = 83;
                _localctx._CLOSED_PARENTHESIS = this.match(mongoParser.T__2);
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public argument(): ArgumentContext {
        const _localctx: ArgumentContext = new ArgumentContext(this._ctx, this.state);
        this.enterRule(_localctx, 14, mongoParser.RULE_argument);
        try {
            this.state = 88;
            this._errHandler.sync(this);
            switch (this._input.LA(1)) {
                case mongoParser.RegexLiteral:
                case mongoParser.StringLiteral:
                case mongoParser.NullLiteral:
                case mongoParser.BooleanLiteral:
                case mongoParser.NumericLiteral:
                    this.enterOuterAlt(_localctx, 1);
                    {
                        this.state = 85;
                        this.literal();
                    }
                    break;
                case mongoParser.T__3:
                    this.enterOuterAlt(_localctx, 2);
                    {
                        this.state = 86;
                        this.objectLiteral();
                    }
                    break;
                case mongoParser.T__5:
                    this.enterOuterAlt(_localctx, 3);
                    {
                        this.state = 87;
                        this.arrayLiteral();
                    }
                    break;
                default:
                    throw new NoViableAltException(this);
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public objectLiteral(): ObjectLiteralContext {
        const _localctx: ObjectLiteralContext = new ObjectLiteralContext(this._ctx, this.state);
        this.enterRule(_localctx, 16, mongoParser.RULE_objectLiteral);
        let _la: number;
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 90;
                this.match(mongoParser.T__3);
                this.state = 92;
                this._errHandler.sync(this);
                _la = this._input.LA(1);
                if (_la === mongoParser.StringLiteral || _la === mongoParser.IDENTIFIER) {
                    {
                        this.state = 91;
                        this.propertyNameAndValueList();
                    }
                }

                this.state = 95;
                this._errHandler.sync(this);
                _la = this._input.LA(1);
                if (_la === mongoParser.T__1) {
                    {
                        this.state = 94;
                        this.match(mongoParser.T__1);
                    }
                }

                this.state = 97;
                this.match(mongoParser.T__4);
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public arrayLiteral(): ArrayLiteralContext {
        const _localctx: ArrayLiteralContext = new ArrayLiteralContext(this._ctx, this.state);
        this.enterRule(_localctx, 18, mongoParser.RULE_arrayLiteral);
        let _la: number;
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 99;
                this.match(mongoParser.T__5);
                this.state = 101;
                this._errHandler.sync(this);
                _la = this._input.LA(1);
                if (
                    (_la & ~0x1f) === 0 &&
                    ((1 << _la) &
                        ((1 << mongoParser.T__3) |
                            (1 << mongoParser.T__5) |
                            (1 << mongoParser.RegexLiteral) |
                            (1 << mongoParser.StringLiteral) |
                            (1 << mongoParser.NullLiteral) |
                            (1 << mongoParser.BooleanLiteral) |
                            (1 << mongoParser.NumericLiteral) |
                            (1 << mongoParser.IDENTIFIER))) !==
                        0
                ) {
                    {
                        this.state = 100;
                        this.elementList();
                    }
                }

                this.state = 103;
                this.match(mongoParser.T__6);
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public elementList(): ElementListContext {
        const _localctx: ElementListContext = new ElementListContext(this._ctx, this.state);
        this.enterRule(_localctx, 20, mongoParser.RULE_elementList);
        let _la: number;
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 105;
                this.propertyValue();
                this.state = 110;
                this._errHandler.sync(this);
                _la = this._input.LA(1);
                while (_la === mongoParser.T__1) {
                    {
                        {
                            this.state = 106;
                            this.match(mongoParser.T__1);
                            this.state = 107;
                            this.propertyValue();
                        }
                    }
                    this.state = 112;
                    this._errHandler.sync(this);
                    _la = this._input.LA(1);
                }
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public propertyNameAndValueList(): PropertyNameAndValueListContext {
        const _localctx: PropertyNameAndValueListContext = new PropertyNameAndValueListContext(this._ctx, this.state);
        this.enterRule(_localctx, 22, mongoParser.RULE_propertyNameAndValueList);
        try {
            let _alt: number;
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 113;
                this.propertyAssignment();
                this.state = 118;
                this._errHandler.sync(this);
                _alt = this.interpreter.adaptivePredict(this._input, 13, this._ctx);
                while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
                    if (_alt === 1) {
                        {
                            {
                                this.state = 114;
                                this.match(mongoParser.T__1);
                                this.state = 115;
                                this.propertyAssignment();
                            }
                        }
                    }
                    this.state = 120;
                    this._errHandler.sync(this);
                    _alt = this.interpreter.adaptivePredict(this._input, 13, this._ctx);
                }
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public propertyAssignment(): PropertyAssignmentContext {
        const _localctx: PropertyAssignmentContext = new PropertyAssignmentContext(this._ctx, this.state);
        this.enterRule(_localctx, 24, mongoParser.RULE_propertyAssignment);
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 121;
                this.propertyName();
                this.state = 122;
                this.match(mongoParser.T__7);
                this.state = 123;
                this.propertyValue();
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public propertyValue(): PropertyValueContext {
        const _localctx: PropertyValueContext = new PropertyValueContext(this._ctx, this.state);
        this.enterRule(_localctx, 26, mongoParser.RULE_propertyValue);
        try {
            this.state = 129;
            this._errHandler.sync(this);
            switch (this._input.LA(1)) {
                case mongoParser.RegexLiteral:
                case mongoParser.StringLiteral:
                case mongoParser.NullLiteral:
                case mongoParser.BooleanLiteral:
                case mongoParser.NumericLiteral:
                    this.enterOuterAlt(_localctx, 1);
                    {
                        this.state = 125;
                        this.literal();
                    }
                    break;
                case mongoParser.T__3:
                    this.enterOuterAlt(_localctx, 2);
                    {
                        this.state = 126;
                        this.objectLiteral();
                    }
                    break;
                case mongoParser.T__5:
                    this.enterOuterAlt(_localctx, 3);
                    {
                        this.state = 127;
                        this.arrayLiteral();
                    }
                    break;
                case mongoParser.IDENTIFIER:
                    this.enterOuterAlt(_localctx, 4);
                    {
                        this.state = 128;
                        this.functionCall();
                    }
                    break;
                default:
                    throw new NoViableAltException(this);
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public literal(): LiteralContext {
        const _localctx: LiteralContext = new LiteralContext(this._ctx, this.state);
        this.enterRule(_localctx, 28, mongoParser.RULE_literal);
        let _la: number;
        try {
            this.state = 134;
            this._errHandler.sync(this);
            switch (this._input.LA(1)) {
                case mongoParser.StringLiteral:
                case mongoParser.NullLiteral:
                case mongoParser.BooleanLiteral:
                    this.enterOuterAlt(_localctx, 1);
                    {
                        this.state = 131;
                        _la = this._input.LA(1);
                        if (
                            !(
                                (_la & ~0x1f) === 0 &&
                                ((1 << _la) &
                                    ((1 << mongoParser.StringLiteral) |
                                        (1 << mongoParser.NullLiteral) |
                                        (1 << mongoParser.BooleanLiteral))) !==
                                    0
                            )
                        ) {
                            this._errHandler.recoverInline(this);
                        } else {
                            if (this._input.LA(1) === Token.EOF) {
                                this.matchedEOF = true;
                            }

                            this._errHandler.reportMatch(this);
                            this.consume();
                        }
                    }
                    break;
                case mongoParser.RegexLiteral:
                    this.enterOuterAlt(_localctx, 2);
                    {
                        this.state = 132;
                        this.match(mongoParser.RegexLiteral);
                    }
                    break;
                case mongoParser.NumericLiteral:
                    this.enterOuterAlt(_localctx, 3);
                    {
                        this.state = 133;
                        this.match(mongoParser.NumericLiteral);
                    }
                    break;
                default:
                    throw new NoViableAltException(this);
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public propertyName(): PropertyNameContext {
        const _localctx: PropertyNameContext = new PropertyNameContext(this._ctx, this.state);
        this.enterRule(_localctx, 30, mongoParser.RULE_propertyName);
        let _la: number;
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 136;
                _la = this._input.LA(1);
                if (!(_la === mongoParser.StringLiteral || _la === mongoParser.IDENTIFIER)) {
                    this._errHandler.recoverInline(this);
                } else {
                    if (this._input.LA(1) === Token.EOF) {
                        this.matchedEOF = true;
                    }

                    this._errHandler.reportMatch(this);
                    this.consume();
                }
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }
    @RuleVersion(0)
    public comment(): CommentContext {
        const _localctx: CommentContext = new CommentContext(this._ctx, this.state);
        this.enterRule(_localctx, 32, mongoParser.RULE_comment);
        let _la: number;
        try {
            this.enterOuterAlt(_localctx, 1);
            {
                this.state = 138;
                _la = this._input.LA(1);
                if (!(_la === mongoParser.SingleLineComment || _la === mongoParser.MultiLineComment)) {
                    this._errHandler.recoverInline(this);
                } else {
                    if (this._input.LA(1) === Token.EOF) {
                        this.matchedEOF = true;
                    }

                    this._errHandler.reportMatch(this);
                    this.consume();
                }
            }
        } catch (re) {
            if (re instanceof RecognitionException) {
                _localctx.exception = re;
                this._errHandler.reportError(this, re);
                this._errHandler.recover(this, re);
            } else {
                throw re;
            }
        } finally {
            this.exitRule();
        }
        return _localctx;
    }

    public static readonly _serializedATN: string =
        '\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x03\x1A\x8F\x04\x02' +
        '\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04\x07' +
        '\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r\x04' +
        '\x0E\t\x0E\x04\x0F\t\x0F\x04\x10\t\x10\x04\x11\t\x11\x04\x12\t\x12\x03' +
        '\x02\x03\x02\x03\x02\x03\x03\x03\x03\x03\x03\x07\x03+\n\x03\f\x03\x0E' +
        '\x03.\v\x03\x03\x04\x03\x04\x03\x04\x05\x043\n\x04\x03\x04\x03\x04\x06' +
        '\x047\n\x04\r\x04\x0E\x048\x03\x04\x05\x04<\n\x04\x03\x05\x03\x05\x03' +
        '\x06\x03\x06\x03\x06\x07\x06C\n\x06\f\x06\x0E\x06F\v\x06\x03\x07\x03\x07' +
        '\x03\x07\x03\b\x03\b\x03\b\x03\b\x07\bO\n\b\f\b\x0E\bR\v\b\x05\bT\n\b' +
        '\x03\b\x03\b\x03\t\x03\t\x03\t\x05\t[\n\t\x03\n\x03\n\x05\n_\n\n\x03\n' +
        '\x05\nb\n\n\x03\n\x03\n\x03\v\x03\v\x05\vh\n\v\x03\v\x03\v\x03\f\x03\f' +
        '\x03\f\x07\fo\n\f\f\f\x0E\fr\v\f\x03\r\x03\r\x03\r\x07\rw\n\r\f\r\x0E' +
        '\rz\v\r\x03\x0E\x03\x0E\x03\x0E\x03\x0E\x03\x0F\x03\x0F\x03\x0F\x03\x0F' +
        '\x05\x0F\x84\n\x0F\x03\x10\x03\x10\x03\x10\x05\x10\x89\n\x10\x03\x11\x03' +
        '\x11\x03\x12\x03\x12\x03\x12\x02\x02\x02\x13\x02\x02\x04\x02\x06\x02\b' +
        '\x02\n\x02\f\x02\x0E\x02\x10\x02\x12\x02\x14\x02\x16\x02\x18\x02\x1A\x02' +
        '\x1C\x02\x1E\x02 \x02"\x02\x02\x05\x03\x02\x0E\x10\x04\x02\x0E\x0E\x17' +
        '\x17\x03\x02\f\r\x92\x02$\x03\x02\x02\x02\x04,\x03\x02\x02\x02\x06/\x03' +
        '\x02\x02\x02\b=\x03\x02\x02\x02\n?\x03\x02\x02\x02\fG\x03\x02\x02\x02' +
        '\x0EJ\x03\x02\x02\x02\x10Z\x03\x02\x02\x02\x12\\\x03\x02\x02\x02\x14e' +
        '\x03\x02\x02\x02\x16k\x03\x02\x02\x02\x18s\x03\x02\x02\x02\x1A{\x03\x02' +
        '\x02\x02\x1C\x83\x03\x02\x02\x02\x1E\x88\x03\x02\x02\x02 \x8A\x03\x02' +
        '\x02\x02"\x8C\x03\x02\x02\x02$%\x05\x04\x03\x02%&\x07\x02\x02\x03&\x03' +
        "\x03\x02\x02\x02'+\x05\x06\x04\x02(+\x05\b\x05\x02)+\x05\"\x12\x02*'" +
        '\x03\x02\x02\x02*(\x03\x02\x02\x02*)\x03\x02\x02\x02+.\x03\x02\x02\x02' +
        ',*\x03\x02\x02\x02,-\x03\x02\x02\x02-\x05\x03\x02\x02\x02.,\x03\x02\x02' +
        '\x02/2\x07\x16\x02\x0201\x07\x15\x02\x0213\x05\n\x06\x0220\x03\x02\x02' +
        '\x0223\x03\x02\x02\x0236\x03\x02\x02\x0245\x07\x15\x02\x0257\x05\f\x07' +
        '\x0264\x03\x02\x02\x0278\x03\x02\x02\x0286\x03\x02\x02\x0289\x03\x02\x02' +
        '\x029;\x03\x02\x02\x02:<\x07\x14\x02\x02;:\x03\x02\x02\x02;<\x03\x02\x02' +
        '\x02<\x07\x03\x02\x02\x02=>\x07\x14\x02\x02>\t\x03\x02\x02\x02?D\x07\x17' +
        '\x02\x02@A\x07\x15\x02\x02AC\x07\x17\x02\x02B@\x03\x02\x02\x02CF\x03\x02' +
        '\x02\x02DB\x03\x02\x02\x02DE\x03\x02\x02\x02E\v\x03\x02\x02\x02FD\x03' +
        '\x02\x02\x02GH\x07\x17\x02\x02HI\x05\x0E\b\x02I\r\x03\x02\x02\x02JS\x07' +
        '\x03\x02\x02KP\x05\x10\t\x02LM\x07\x04\x02\x02MO\x05\x10\t\x02NL\x03\x02' +
        '\x02\x02OR\x03\x02\x02\x02PN\x03\x02\x02\x02PQ\x03\x02\x02\x02QT\x03\x02' +
        '\x02\x02RP\x03\x02\x02\x02SK\x03\x02\x02\x02ST\x03\x02\x02\x02TU\x03\x02' +
        '\x02\x02UV\x07\x05\x02\x02V\x0F\x03\x02\x02\x02W[\x05\x1E\x10\x02X[\x05' +
        '\x12\n\x02Y[\x05\x14\v\x02ZW\x03\x02\x02\x02ZX\x03\x02\x02\x02ZY\x03\x02' +
        '\x02\x02[\x11\x03\x02\x02\x02\\^\x07\x06\x02\x02]_\x05\x18\r\x02^]\x03' +
        '\x02\x02\x02^_\x03\x02\x02\x02_a\x03\x02\x02\x02`b\x07\x04\x02\x02a`\x03' +
        '\x02\x02\x02ab\x03\x02\x02\x02bc\x03\x02\x02\x02cd\x07\x07\x02\x02d\x13' +
        '\x03\x02\x02\x02eg\x07\b\x02\x02fh\x05\x16\f\x02gf\x03\x02\x02\x02gh\x03' +
        '\x02\x02\x02hi\x03\x02\x02\x02ij\x07\t\x02\x02j\x15\x03\x02\x02\x02kp' +
        '\x05\x1C\x0F\x02lm\x07\x04\x02\x02mo\x05\x1C\x0F\x02nl\x03\x02\x02\x02' +
        'or\x03\x02\x02\x02pn\x03\x02\x02\x02pq\x03\x02\x02\x02q\x17\x03\x02\x02' +
        '\x02rp\x03\x02\x02\x02sx\x05\x1A\x0E\x02tu\x07\x04\x02\x02uw\x05\x1A\x0E' +
        '\x02vt\x03\x02\x02\x02wz\x03\x02\x02\x02xv\x03\x02\x02\x02xy\x03\x02\x02' +
        '\x02y\x19\x03\x02\x02\x02zx\x03\x02\x02\x02{|\x05 \x11\x02|}\x07\n\x02' +
        '\x02}~\x05\x1C\x0F\x02~\x1B\x03\x02\x02\x02\x7F\x84\x05\x1E\x10\x02\x80' +
        '\x84\x05\x12\n\x02\x81\x84\x05\x14\v\x02\x82\x84\x05\f\x07\x02\x83\x7F' +
        '\x03\x02\x02\x02\x83\x80\x03\x02\x02\x02\x83\x81\x03\x02\x02\x02\x83\x82' +
        '\x03\x02\x02\x02\x84\x1D\x03\x02\x02\x02\x85\x89\t\x02\x02\x02\x86\x89' +
        '\x07\v\x02\x02\x87\x89\x07\x11\x02\x02\x88\x85\x03\x02\x02\x02\x88\x86' +
        '\x03\x02\x02\x02\x88\x87\x03\x02\x02\x02\x89\x1F\x03\x02\x02\x02\x8A\x8B' +
        '\t\x03\x02\x02\x8B!\x03\x02\x02\x02\x8C\x8D\t\x04\x02\x02\x8D#\x03\x02' +
        '\x02\x02\x12*,28;DPSZ^agpx\x83\x88';
    public static __ATN: ATN;
    public static get _ATN(): ATN {
        if (!mongoParser.__ATN) {
            mongoParser.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(mongoParser._serializedATN));
        }

        return mongoParser.__ATN;
    }
}

export class MongoCommandsContext extends ParserRuleContext {
    public commands(): CommandsContext {
        return this.getRuleContext(0, CommandsContext);
    }
    public EOF(): TerminalNode {
        return this.getToken(mongoParser.EOF, 0);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_mongoCommands;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterMongoCommands) listener.enterMongoCommands(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitMongoCommands) listener.exitMongoCommands(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitMongoCommands) return visitor.visitMongoCommands(this);
        else return visitor.visitChildren(this);
    }
}

export class CommandsContext extends ParserRuleContext {
    public command(): CommandContext[];
    public command(i: number): CommandContext;
    public command(i?: number): CommandContext | CommandContext[] {
        if (i === undefined) {
            return this.getRuleContexts(CommandContext);
        } else {
            return this.getRuleContext(i, CommandContext);
        }
    }
    public emptyCommand(): EmptyCommandContext[];
    public emptyCommand(i: number): EmptyCommandContext;
    public emptyCommand(i?: number): EmptyCommandContext | EmptyCommandContext[] {
        if (i === undefined) {
            return this.getRuleContexts(EmptyCommandContext);
        } else {
            return this.getRuleContext(i, EmptyCommandContext);
        }
    }
    public comment(): CommentContext[];
    public comment(i: number): CommentContext;
    public comment(i?: number): CommentContext | CommentContext[] {
        if (i === undefined) {
            return this.getRuleContexts(CommentContext);
        } else {
            return this.getRuleContext(i, CommentContext);
        }
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_commands;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterCommands) listener.enterCommands(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitCommands) listener.exitCommands(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitCommands) return visitor.visitCommands(this);
        else return visitor.visitChildren(this);
    }
}

export class CommandContext extends ParserRuleContext {
    public DB(): TerminalNode {
        return this.getToken(mongoParser.DB, 0);
    }
    public DOT(): TerminalNode[];
    public DOT(i: number): TerminalNode;
    public DOT(i?: number): TerminalNode | TerminalNode[] {
        if (i === undefined) {
            return this.getTokens(mongoParser.DOT);
        } else {
            return this.getToken(mongoParser.DOT, i);
        }
    }
    public collection(): CollectionContext | undefined {
        return this.tryGetRuleContext(0, CollectionContext);
    }
    public functionCall(): FunctionCallContext[];
    public functionCall(i: number): FunctionCallContext;
    public functionCall(i?: number): FunctionCallContext | FunctionCallContext[] {
        if (i === undefined) {
            return this.getRuleContexts(FunctionCallContext);
        } else {
            return this.getRuleContext(i, FunctionCallContext);
        }
    }
    public SEMICOLON(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.SEMICOLON, 0);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_command;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterCommand) listener.enterCommand(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitCommand) listener.exitCommand(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitCommand) return visitor.visitCommand(this);
        else return visitor.visitChildren(this);
    }
}

export class EmptyCommandContext extends ParserRuleContext {
    public SEMICOLON(): TerminalNode {
        return this.getToken(mongoParser.SEMICOLON, 0);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_emptyCommand;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterEmptyCommand) listener.enterEmptyCommand(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitEmptyCommand) listener.exitEmptyCommand(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitEmptyCommand) return visitor.visitEmptyCommand(this);
        else return visitor.visitChildren(this);
    }
}

export class CollectionContext extends ParserRuleContext {
    public IDENTIFIER(): TerminalNode[];
    public IDENTIFIER(i: number): TerminalNode;
    public IDENTIFIER(i?: number): TerminalNode | TerminalNode[] {
        if (i === undefined) {
            return this.getTokens(mongoParser.IDENTIFIER);
        } else {
            return this.getToken(mongoParser.IDENTIFIER, i);
        }
    }
    public DOT(): TerminalNode[];
    public DOT(i: number): TerminalNode;
    public DOT(i?: number): TerminalNode | TerminalNode[] {
        if (i === undefined) {
            return this.getTokens(mongoParser.DOT);
        } else {
            return this.getToken(mongoParser.DOT, i);
        }
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_collection;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterCollection) listener.enterCollection(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitCollection) listener.exitCollection(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitCollection) return visitor.visitCollection(this);
        else return visitor.visitChildren(this);
    }
}

export class FunctionCallContext extends ParserRuleContext {
    public _FUNCTION_NAME: Token;
    public arguments(): ArgumentsContext {
        return this.getRuleContext(0, ArgumentsContext);
    }
    public IDENTIFIER(): TerminalNode {
        return this.getToken(mongoParser.IDENTIFIER, 0);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_functionCall;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterFunctionCall) listener.enterFunctionCall(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitFunctionCall) listener.exitFunctionCall(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitFunctionCall) return visitor.visitFunctionCall(this);
        else return visitor.visitChildren(this);
    }
}

export class ArgumentsContext extends ParserRuleContext {
    public _OPEN_PARENTHESIS: Token;
    public _CLOSED_PARENTHESIS: Token;
    public argument(): ArgumentContext[];
    public argument(i: number): ArgumentContext;
    public argument(i?: number): ArgumentContext | ArgumentContext[] {
        if (i === undefined) {
            return this.getRuleContexts(ArgumentContext);
        } else {
            return this.getRuleContext(i, ArgumentContext);
        }
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_arguments;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterArguments) listener.enterArguments(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitArguments) listener.exitArguments(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitArguments) return visitor.visitArguments(this);
        else return visitor.visitChildren(this);
    }
}

export class ArgumentContext extends ParserRuleContext {
    public literal(): LiteralContext | undefined {
        return this.tryGetRuleContext(0, LiteralContext);
    }
    public objectLiteral(): ObjectLiteralContext | undefined {
        return this.tryGetRuleContext(0, ObjectLiteralContext);
    }
    public arrayLiteral(): ArrayLiteralContext | undefined {
        return this.tryGetRuleContext(0, ArrayLiteralContext);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_argument;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterArgument) listener.enterArgument(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitArgument) listener.exitArgument(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitArgument) return visitor.visitArgument(this);
        else return visitor.visitChildren(this);
    }
}

export class ObjectLiteralContext extends ParserRuleContext {
    public propertyNameAndValueList(): PropertyNameAndValueListContext | undefined {
        return this.tryGetRuleContext(0, PropertyNameAndValueListContext);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_objectLiteral;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterObjectLiteral) listener.enterObjectLiteral(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitObjectLiteral) listener.exitObjectLiteral(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitObjectLiteral) return visitor.visitObjectLiteral(this);
        else return visitor.visitChildren(this);
    }
}

export class ArrayLiteralContext extends ParserRuleContext {
    public elementList(): ElementListContext | undefined {
        return this.tryGetRuleContext(0, ElementListContext);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_arrayLiteral;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterArrayLiteral) listener.enterArrayLiteral(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitArrayLiteral) listener.exitArrayLiteral(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitArrayLiteral) return visitor.visitArrayLiteral(this);
        else return visitor.visitChildren(this);
    }
}

export class ElementListContext extends ParserRuleContext {
    public propertyValue(): PropertyValueContext[];
    public propertyValue(i: number): PropertyValueContext;
    public propertyValue(i?: number): PropertyValueContext | PropertyValueContext[] {
        if (i === undefined) {
            return this.getRuleContexts(PropertyValueContext);
        } else {
            return this.getRuleContext(i, PropertyValueContext);
        }
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_elementList;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterElementList) listener.enterElementList(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitElementList) listener.exitElementList(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitElementList) return visitor.visitElementList(this);
        else return visitor.visitChildren(this);
    }
}

export class PropertyNameAndValueListContext extends ParserRuleContext {
    public propertyAssignment(): PropertyAssignmentContext[];
    public propertyAssignment(i: number): PropertyAssignmentContext;
    public propertyAssignment(i?: number): PropertyAssignmentContext | PropertyAssignmentContext[] {
        if (i === undefined) {
            return this.getRuleContexts(PropertyAssignmentContext);
        } else {
            return this.getRuleContext(i, PropertyAssignmentContext);
        }
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_propertyNameAndValueList;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterPropertyNameAndValueList) listener.enterPropertyNameAndValueList(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitPropertyNameAndValueList) listener.exitPropertyNameAndValueList(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitPropertyNameAndValueList) return visitor.visitPropertyNameAndValueList(this);
        else return visitor.visitChildren(this);
    }
}

export class PropertyAssignmentContext extends ParserRuleContext {
    public propertyName(): PropertyNameContext {
        return this.getRuleContext(0, PropertyNameContext);
    }
    public propertyValue(): PropertyValueContext {
        return this.getRuleContext(0, PropertyValueContext);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_propertyAssignment;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterPropertyAssignment) listener.enterPropertyAssignment(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitPropertyAssignment) listener.exitPropertyAssignment(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitPropertyAssignment) return visitor.visitPropertyAssignment(this);
        else return visitor.visitChildren(this);
    }
}

export class PropertyValueContext extends ParserRuleContext {
    public literal(): LiteralContext | undefined {
        return this.tryGetRuleContext(0, LiteralContext);
    }
    public objectLiteral(): ObjectLiteralContext | undefined {
        return this.tryGetRuleContext(0, ObjectLiteralContext);
    }
    public arrayLiteral(): ArrayLiteralContext | undefined {
        return this.tryGetRuleContext(0, ArrayLiteralContext);
    }
    public functionCall(): FunctionCallContext | undefined {
        return this.tryGetRuleContext(0, FunctionCallContext);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_propertyValue;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterPropertyValue) listener.enterPropertyValue(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitPropertyValue) listener.exitPropertyValue(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitPropertyValue) return visitor.visitPropertyValue(this);
        else return visitor.visitChildren(this);
    }
}

export class LiteralContext extends ParserRuleContext {
    public NullLiteral(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.NullLiteral, 0);
    }
    public BooleanLiteral(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.BooleanLiteral, 0);
    }
    public StringLiteral(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.StringLiteral, 0);
    }
    public RegexLiteral(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.RegexLiteral, 0);
    }
    public NumericLiteral(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.NumericLiteral, 0);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_literal;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterLiteral) listener.enterLiteral(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitLiteral) listener.exitLiteral(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitLiteral) return visitor.visitLiteral(this);
        else return visitor.visitChildren(this);
    }
}

export class PropertyNameContext extends ParserRuleContext {
    public StringLiteral(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.StringLiteral, 0);
    }
    public IDENTIFIER(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.IDENTIFIER, 0);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_propertyName;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterPropertyName) listener.enterPropertyName(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitPropertyName) listener.exitPropertyName(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitPropertyName) return visitor.visitPropertyName(this);
        else return visitor.visitChildren(this);
    }
}

export class CommentContext extends ParserRuleContext {
    public SingleLineComment(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.SingleLineComment, 0);
    }
    public MultiLineComment(): TerminalNode | undefined {
        return this.tryGetToken(mongoParser.MultiLineComment, 0);
    }
    constructor(parent: ParserRuleContext, invokingState: number);
    constructor(parent: ParserRuleContext, invokingState: number) {
        super(parent, invokingState);
    }
    @Override public get ruleIndex(): number {
        return mongoParser.RULE_comment;
    }
    @Override
    public enterRule(listener: mongoListener): void {
        if (listener.enterComment) listener.enterComment(this);
    }
    @Override
    public exitRule(listener: mongoListener): void {
        if (listener.exitComment) listener.exitComment(this);
    }
    @Override
    public accept<Result>(visitor: mongoVisitor<Result>): Result {
        if (visitor.visitComment) return visitor.visitComment(this);
        else return visitor.visitChildren(this);
    }
}
