/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Generated from ./grammar/mongo.g4 by ANTLR 4.6-SNAPSHOT


import { ATN } from 'antlr4ts/atn/ATN';
import { ATNDeserializer } from 'antlr4ts/atn/ATNDeserializer';
import { FailedPredicateException } from 'antlr4ts/FailedPredicateException';
import { NotNull } from 'antlr4ts/Decorators';
import { NoViableAltException } from 'antlr4ts/NoViableAltException';
import { Override } from 'antlr4ts/Decorators';
import { Parser } from 'antlr4ts/Parser';
import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { ParserATNSimulator } from 'antlr4ts/atn/ParserATNSimulator';
import { ParseTreeListener } from 'antlr4ts/tree/ParseTreeListener';
import { ParseTreeVisitor } from 'antlr4ts/tree/ParseTreeVisitor';
import { RecognitionException } from 'antlr4ts/RecognitionException';
import { RuleContext } from 'antlr4ts/RuleContext';
import { RuleVersion } from 'antlr4ts/RuleVersion';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { Token } from 'antlr4ts/Token';
import { TokenStream } from 'antlr4ts/TokenStream';
import { Vocabulary } from 'antlr4ts/Vocabulary';
import { VocabularyImpl } from 'antlr4ts/VocabularyImpl';

import * as Utils from 'antlr4ts/misc/Utils';

import { mongoListener } from './mongoListener';
import { mongoVisitor } from './mongoVisitor';


export class mongoParser extends Parser {
	public static readonly T__0=1;
	public static readonly T__1=2;
	public static readonly T__2=3;
	public static readonly T__3=4;
	public static readonly T__4=5;
	public static readonly T__5=6;
	public static readonly T__6=7;
	public static readonly T__7=8;
	public static readonly SingleLineComment=9;
	public static readonly MultiLineComment=10;
	public static readonly StringLiteral=11;
	public static readonly NullLiteral=12;
	public static readonly BooleanLiteral=13;
	public static readonly NumericLiteral=14;
	public static readonly DecimalLiteral=15;
	public static readonly LineTerminator=16;
	public static readonly SEMICOLON=17;
	public static readonly DOT=18;
	public static readonly DB=19;
	public static readonly LF=20;
	public static readonly CRLF=21;
	public static readonly STRING_LITERAL=22;
	public static readonly DOUBLE_QUOTED_STRING_LITERAL=23;
	public static readonly SINGLE_QUOTED_STRING_LITERAL=24;
	public static readonly WHITESPACE=25;
	public static readonly RULE_mongoCommands = 0;
	public static readonly RULE_commands = 1;
	public static readonly RULE_command = 2;
	public static readonly RULE_emptyCommand = 3;
	public static readonly RULE_collection = 4;
	public static readonly RULE_functionCall = 5;
	public static readonly RULE_arguments = 6;
	public static readonly RULE_argumentList = 7;
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
		"mongoCommands", "commands", "command", "emptyCommand", "collection", 
		"functionCall", "arguments", "argumentList", "objectLiteral", "arrayLiteral", 
		"elementList", "propertyNameAndValueList", "propertyAssignment", "propertyValue", 
		"literal", "propertyName", "comment"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'('", "')'", "'{'", "','", "'}'", "'['", "']'", "':'", undefined, 
		undefined, undefined, "'null'", undefined, undefined, undefined, undefined, 
		"';'", "'.'", "'db'", "'\n'", "'\r\n'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, undefined, undefined, undefined, undefined, undefined, undefined, 
		undefined, undefined, "SingleLineComment", "MultiLineComment", "StringLiteral", 
		"NullLiteral", "BooleanLiteral", "NumericLiteral", "DecimalLiteral", "LineTerminator", 
		"SEMICOLON", "DOT", "DB", "LF", "CRLF", "STRING_LITERAL", "DOUBLE_QUOTED_STRING_LITERAL", 
		"SINGLE_QUOTED_STRING_LITERAL", "WHITESPACE"
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(mongoParser._LITERAL_NAMES, mongoParser._SYMBOLIC_NAMES, []);

	@Override
	@NotNull
	public get vocabulary(): Vocabulary {
		return mongoParser.VOCABULARY;
	}

	@Override
	public get grammarFileName(): string { return "mongo.g4"; }

	@Override
	public get ruleNames(): string[] { return mongoParser.ruleNames; }

	@Override
	public get serializedATN(): string { return mongoParser._serializedATN; }

	constructor(input: TokenStream) {
		super(input);
		this._interp = new ParserATNSimulator(mongoParser._ATN, this);
	}
	@RuleVersion(0)
	public mongoCommands(): MongoCommandsContext {
		let _localctx: MongoCommandsContext = new MongoCommandsContext(this._ctx, this.state);
		this.enterRule(_localctx, 0, mongoParser.RULE_mongoCommands);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 34;
			this.commands();
			this.state = 35;
			this.match(mongoParser.EOF);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public commands(): CommandsContext {
		let _localctx: CommandsContext = new CommandsContext(this._ctx, this.state);
		this.enterRule(_localctx, 2, mongoParser.RULE_commands);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 40; 
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			do {
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
				this.state = 42; 
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			} while ( (((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << mongoParser.SingleLineComment) | (1 << mongoParser.MultiLineComment) | (1 << mongoParser.SEMICOLON) | (1 << mongoParser.DB))) !== 0) );
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public command(): CommandContext {
		let _localctx: CommandContext = new CommandContext(this._ctx, this.state);
		this.enterRule(_localctx, 4, mongoParser.RULE_command);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 44;
			this.match(mongoParser.DB);
			this.state = 45;
			this.match(mongoParser.DOT);
			this.state = 51;
			this._errHandler.sync(this);
			switch ( this.interpreter.adaptivePredict(this._input,2,this._ctx) ) {
			case 1:
				{
				this.state = 46;
				this.functionCall();
				}
				break;

			case 2:
				{
				{
				this.state = 47;
				this.collection();
				this.state = 48;
				this.match(mongoParser.DOT);
				this.state = 49;
				this.functionCall();
				}
				}
				break;
			}
			this.state = 54;
			this._errHandler.sync(this);
			switch ( this.interpreter.adaptivePredict(this._input,3,this._ctx) ) {
			case 1:
				{
				this.state = 53;
				this.match(mongoParser.SEMICOLON);
				}
				break;
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public emptyCommand(): EmptyCommandContext {
		let _localctx: EmptyCommandContext = new EmptyCommandContext(this._ctx, this.state);
		this.enterRule(_localctx, 6, mongoParser.RULE_emptyCommand);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 56;
			this.match(mongoParser.SEMICOLON);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public collection(): CollectionContext {
		let _localctx: CollectionContext = new CollectionContext(this._ctx, this.state);
		this.enterRule(_localctx, 8, mongoParser.RULE_collection);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 58;
			this.match(mongoParser.STRING_LITERAL);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public functionCall(): FunctionCallContext {
		let _localctx: FunctionCallContext = new FunctionCallContext(this._ctx, this.state);
		this.enterRule(_localctx, 10, mongoParser.RULE_functionCall);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 60;
			_localctx._FUNCTION_NAME = this.match(mongoParser.STRING_LITERAL);
			this.state = 61;
			this.arguments();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public arguments(): ArgumentsContext {
		let _localctx: ArgumentsContext = new ArgumentsContext(this._ctx, this.state);
		this.enterRule(_localctx, 12, mongoParser.RULE_arguments);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 63;
			_localctx._OPEN_PARENTHESIS = this.match(mongoParser.T__0);
			this.state = 65;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if ((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << mongoParser.T__2) | (1 << mongoParser.T__5) | (1 << mongoParser.StringLiteral) | (1 << mongoParser.NullLiteral) | (1 << mongoParser.BooleanLiteral) | (1 << mongoParser.NumericLiteral))) !== 0)) {
				{
				this.state = 64;
				this.argumentList();
				}
			}

			this.state = 67;
			_localctx._CLOSED_PARENTHESIS = this.match(mongoParser.T__1);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public argumentList(): ArgumentListContext {
		let _localctx: ArgumentListContext = new ArgumentListContext(this._ctx, this.state);
		this.enterRule(_localctx, 14, mongoParser.RULE_argumentList);
		try {
			this.state = 72;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case mongoParser.StringLiteral:
			case mongoParser.NullLiteral:
			case mongoParser.BooleanLiteral:
			case mongoParser.NumericLiteral:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 69;
				this.literal();
				}
				break;
			case mongoParser.T__2:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 70;
				this.objectLiteral();
				}
				break;
			case mongoParser.T__5:
				this.enterOuterAlt(_localctx, 3);
				{
				this.state = 71;
				this.arrayLiteral();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public objectLiteral(): ObjectLiteralContext {
		let _localctx: ObjectLiteralContext = new ObjectLiteralContext(this._ctx, this.state);
		this.enterRule(_localctx, 16, mongoParser.RULE_objectLiteral);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 74;
			this.match(mongoParser.T__2);
			this.state = 76;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===mongoParser.StringLiteral) {
				{
				this.state = 75;
				this.propertyNameAndValueList();
				}
			}

			this.state = 79;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la===mongoParser.T__3) {
				{
				this.state = 78;
				this.match(mongoParser.T__3);
				}
			}

			this.state = 81;
			this.match(mongoParser.T__4);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public arrayLiteral(): ArrayLiteralContext {
		let _localctx: ArrayLiteralContext = new ArrayLiteralContext(this._ctx, this.state);
		this.enterRule(_localctx, 18, mongoParser.RULE_arrayLiteral);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 83;
			this.match(mongoParser.T__5);
			this.state = 85;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if ((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << mongoParser.T__2) | (1 << mongoParser.T__5) | (1 << mongoParser.StringLiteral) | (1 << mongoParser.NullLiteral) | (1 << mongoParser.BooleanLiteral) | (1 << mongoParser.NumericLiteral) | (1 << mongoParser.STRING_LITERAL))) !== 0)) {
				{
				this.state = 84;
				this.elementList();
				}
			}

			this.state = 87;
			this.match(mongoParser.T__6);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public elementList(): ElementListContext {
		let _localctx: ElementListContext = new ElementListContext(this._ctx, this.state);
		this.enterRule(_localctx, 20, mongoParser.RULE_elementList);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 89;
			this.propertyValue();
			this.state = 94;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while (_la===mongoParser.T__3) {
				{
				{
				this.state = 90;
				this.match(mongoParser.T__3);
				this.state = 91;
				this.propertyValue();
				}
				}
				this.state = 96;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public propertyNameAndValueList(): PropertyNameAndValueListContext {
		let _localctx: PropertyNameAndValueListContext = new PropertyNameAndValueListContext(this._ctx, this.state);
		this.enterRule(_localctx, 22, mongoParser.RULE_propertyNameAndValueList);
		try {
			let _alt: number;
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 97;
			this.propertyAssignment();
			this.state = 102;
			this._errHandler.sync(this);
			_alt = this.interpreter.adaptivePredict(this._input,10,this._ctx);
			while ( _alt!==2 && _alt!==ATN.INVALID_ALT_NUMBER ) {
				if ( _alt===1 ) {
					{
					{
					this.state = 98;
					this.match(mongoParser.T__3);
					this.state = 99;
					this.propertyAssignment();
					}
					} 
				}
				this.state = 104;
				this._errHandler.sync(this);
				_alt = this.interpreter.adaptivePredict(this._input,10,this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public propertyAssignment(): PropertyAssignmentContext {
		let _localctx: PropertyAssignmentContext = new PropertyAssignmentContext(this._ctx, this.state);
		this.enterRule(_localctx, 24, mongoParser.RULE_propertyAssignment);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 105;
			this.propertyName();
			this.state = 106;
			this.match(mongoParser.T__7);
			this.state = 107;
			this.propertyValue();
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public propertyValue(): PropertyValueContext {
		let _localctx: PropertyValueContext = new PropertyValueContext(this._ctx, this.state);
		this.enterRule(_localctx, 26, mongoParser.RULE_propertyValue);
		try {
			this.state = 113;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case mongoParser.StringLiteral:
			case mongoParser.NullLiteral:
			case mongoParser.BooleanLiteral:
			case mongoParser.NumericLiteral:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 109;
				this.literal();
				}
				break;
			case mongoParser.T__2:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 110;
				this.objectLiteral();
				}
				break;
			case mongoParser.T__5:
				this.enterOuterAlt(_localctx, 3);
				{
				this.state = 111;
				this.arrayLiteral();
				}
				break;
			case mongoParser.STRING_LITERAL:
				this.enterOuterAlt(_localctx, 4);
				{
				this.state = 112;
				this.functionCall();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public literal(): LiteralContext {
		let _localctx: LiteralContext = new LiteralContext(this._ctx, this.state);
		this.enterRule(_localctx, 28, mongoParser.RULE_literal);
		let _la: number;
		try {
			this.state = 117;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case mongoParser.StringLiteral:
			case mongoParser.NullLiteral:
			case mongoParser.BooleanLiteral:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 115;
				_la = this._input.LA(1);
				if ( !((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << mongoParser.StringLiteral) | (1 << mongoParser.NullLiteral) | (1 << mongoParser.BooleanLiteral))) !== 0)) ) {
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
			case mongoParser.NumericLiteral:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 116;
				this.match(mongoParser.NumericLiteral);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public propertyName(): PropertyNameContext {
		let _localctx: PropertyNameContext = new PropertyNameContext(this._ctx, this.state);
		this.enterRule(_localctx, 30, mongoParser.RULE_propertyName);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 119;
			this.match(mongoParser.StringLiteral);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	@RuleVersion(0)
	public comment(): CommentContext {
		let _localctx: CommentContext = new CommentContext(this._ctx, this.state);
		this.enterRule(_localctx, 32, mongoParser.RULE_comment);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 121;
			_la = this._input.LA(1);
			if ( !(_la===mongoParser.SingleLineComment || _la===mongoParser.MultiLineComment) ) {
			this._errHandler.recoverInline(this);
			} else {
				if (this._input.LA(1) === Token.EOF) {
					this.matchedEOF = true;
				}

				this._errHandler.reportMatch(this);
				this.consume();
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}

	public static readonly _serializedATN: string =
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x03\x1B~\x04\x02"+
		"\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04\x07"+
		"\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r\x04"+
		"\x0E\t\x0E\x04\x0F\t\x0F\x04\x10\t\x10\x04\x11\t\x11\x04\x12\t\x12\x03"+
		"\x02\x03\x02\x03\x02\x03\x03\x03\x03\x03\x03\x06\x03+\n\x03\r\x03\x0E"+
		"\x03,\x03\x04\x03\x04\x03\x04\x03\x04\x03\x04\x03\x04\x03\x04\x05\x04"+
		"6\n\x04\x03\x04\x05\x049\n\x04\x03\x05\x03\x05\x03\x06\x03\x06\x03\x07"+
		"\x03\x07\x03\x07\x03\b\x03\b\x05\bD\n\b\x03\b\x03\b\x03\t\x03\t\x03\t"+
		"\x05\tK\n\t\x03\n\x03\n\x05\nO\n\n\x03\n\x05\nR\n\n\x03\n\x03\n\x03\v"+
		"\x03\v\x05\vX\n\v\x03\v\x03\v\x03\f\x03\f\x03\f\x07\f_\n\f\f\f\x0E\fb"+
		"\v\f\x03\r\x03\r\x03\r\x07\rg\n\r\f\r\x0E\rj\v\r\x03\x0E\x03\x0E\x03\x0E"+
		"\x03\x0E\x03\x0F\x03\x0F\x03\x0F\x03\x0F\x05\x0Ft\n\x0F\x03\x10\x03\x10"+
		"\x05\x10x\n\x10\x03\x11\x03\x11\x03\x12\x03\x12\x03\x12\x02\x02\x02\x13"+
		"\x02\x02\x04\x02\x06\x02\b\x02\n\x02\f\x02\x0E\x02\x10\x02\x12\x02\x14"+
		"\x02\x16\x02\x18\x02\x1A\x02\x1C\x02\x1E\x02 \x02\"\x02\x02\x04\x03\x02"+
		"\r\x0F\x03\x02\v\f}\x02$\x03\x02\x02\x02\x04*\x03\x02\x02\x02\x06.\x03"+
		"\x02\x02\x02\b:\x03\x02\x02\x02\n<\x03\x02\x02\x02\f>\x03\x02\x02\x02"+
		"\x0EA\x03\x02\x02\x02\x10J\x03\x02\x02\x02\x12L\x03\x02\x02\x02\x14U\x03"+
		"\x02\x02\x02\x16[\x03\x02\x02\x02\x18c\x03\x02\x02\x02\x1Ak\x03\x02\x02"+
		"\x02\x1Cs\x03\x02\x02\x02\x1Ew\x03\x02\x02\x02 y\x03\x02\x02\x02\"{\x03"+
		"\x02\x02\x02$%\x05\x04\x03\x02%&\x07\x02\x02\x03&\x03\x03\x02\x02\x02"+
		"\'+\x05\x06\x04\x02(+\x05\b\x05\x02)+\x05\"\x12\x02*\'\x03\x02\x02\x02"+
		"*(\x03\x02\x02\x02*)\x03\x02\x02\x02+,\x03\x02\x02\x02,*\x03\x02\x02\x02"+
		",-\x03\x02\x02\x02-\x05\x03\x02\x02\x02./\x07\x15\x02\x02/5\x07\x14\x02"+
		"\x0206\x05\f\x07\x0212\x05\n\x06\x0223\x07\x14\x02\x0234\x05\f\x07\x02"+
		"46\x03\x02\x02\x0250\x03\x02\x02\x0251\x03\x02\x02\x0268\x03\x02\x02\x02"+
		"79\x07\x13\x02\x0287\x03\x02\x02\x0289\x03\x02\x02\x029\x07\x03\x02\x02"+
		"\x02:;\x07\x13\x02\x02;\t\x03\x02\x02\x02<=\x07\x18\x02\x02=\v\x03\x02"+
		"\x02\x02>?\x07\x18\x02\x02?@\x05\x0E\b\x02@\r\x03\x02\x02\x02AC\x07\x03"+
		"\x02\x02BD\x05\x10\t\x02CB\x03\x02\x02\x02CD\x03\x02\x02\x02DE\x03\x02"+
		"\x02\x02EF\x07\x04\x02\x02F\x0F\x03\x02\x02\x02GK\x05\x1E\x10\x02HK\x05"+
		"\x12\n\x02IK\x05\x14\v\x02JG\x03\x02\x02\x02JH\x03\x02\x02\x02JI\x03\x02"+
		"\x02\x02K\x11\x03\x02\x02\x02LN\x07\x05\x02\x02MO\x05\x18\r\x02NM\x03"+
		"\x02\x02\x02NO\x03\x02\x02\x02OQ\x03\x02\x02\x02PR\x07\x06\x02\x02QP\x03"+
		"\x02\x02\x02QR\x03\x02\x02\x02RS\x03\x02\x02\x02ST\x07\x07\x02\x02T\x13"+
		"\x03\x02\x02\x02UW\x07\b\x02\x02VX\x05\x16\f\x02WV\x03\x02\x02\x02WX\x03"+
		"\x02\x02\x02XY\x03\x02\x02\x02YZ\x07\t\x02\x02Z\x15\x03\x02\x02\x02[`"+
		"\x05\x1C\x0F\x02\\]\x07\x06\x02\x02]_\x05\x1C\x0F\x02^\\\x03\x02\x02\x02"+
		"_b\x03\x02\x02\x02`^\x03\x02\x02\x02`a\x03\x02\x02\x02a\x17\x03\x02\x02"+
		"\x02b`\x03\x02\x02\x02ch\x05\x1A\x0E\x02de\x07\x06\x02\x02eg\x05\x1A\x0E"+
		"\x02fd\x03\x02\x02\x02gj\x03\x02\x02\x02hf\x03\x02\x02\x02hi\x03\x02\x02"+
		"\x02i\x19\x03\x02\x02\x02jh\x03\x02\x02\x02kl\x05 \x11\x02lm\x07\n\x02"+
		"\x02mn\x05\x1C\x0F\x02n\x1B\x03\x02\x02\x02ot\x05\x1E\x10\x02pt\x05\x12"+
		"\n\x02qt\x05\x14\v\x02rt\x05\f\x07\x02so\x03\x02\x02\x02sp\x03\x02\x02"+
		"\x02sq\x03\x02\x02\x02sr\x03\x02\x02\x02t\x1D\x03\x02\x02\x02ux\t\x02"+
		"\x02\x02vx\x07\x10\x02\x02wu\x03\x02\x02\x02wv\x03\x02\x02\x02x\x1F\x03"+
		"\x02\x02\x02yz\x07\r\x02\x02z!\x03\x02\x02\x02{|\t\x03\x02\x02|#\x03\x02"+
		"\x02\x02\x0F*,58CJNQW`hsw";
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
	public EOF(): TerminalNode { return this.getToken(mongoParser.EOF, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return mongoParser.RULE_mongoCommands; }
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
	@Override public get ruleIndex(): number { return mongoParser.RULE_commands; }
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
	public DB(): TerminalNode { return this.getToken(mongoParser.DB, 0); }
	public DOT(): TerminalNode[];
	public DOT(i: number): TerminalNode;
	public DOT(i?: number): TerminalNode | TerminalNode[] {
		if (i === undefined) {
			return this.getTokens(mongoParser.DOT);
		} else {
			return this.getToken(mongoParser.DOT, i);
		}
	}
	public functionCall(): FunctionCallContext | undefined {
		return this.tryGetRuleContext(0, FunctionCallContext);
	}
	public SEMICOLON(): TerminalNode | undefined { return this.tryGetToken(mongoParser.SEMICOLON, 0); }
	public collection(): CollectionContext | undefined {
		return this.tryGetRuleContext(0, CollectionContext);
	}
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return mongoParser.RULE_command; }
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
	public SEMICOLON(): TerminalNode { return this.getToken(mongoParser.SEMICOLON, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return mongoParser.RULE_emptyCommand; }
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
	public STRING_LITERAL(): TerminalNode { return this.getToken(mongoParser.STRING_LITERAL, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return mongoParser.RULE_collection; }
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
	public STRING_LITERAL(): TerminalNode { return this.getToken(mongoParser.STRING_LITERAL, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return mongoParser.RULE_functionCall; }
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
	public argumentList(): ArgumentListContext | undefined {
		return this.tryGetRuleContext(0, ArgumentListContext);
	}
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return mongoParser.RULE_arguments; }
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


export class ArgumentListContext extends ParserRuleContext {
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
	@Override public get ruleIndex(): number { return mongoParser.RULE_argumentList; }
	@Override
	public enterRule(listener: mongoListener): void {
		if (listener.enterArgumentList) listener.enterArgumentList(this);
	}
	@Override
	public exitRule(listener: mongoListener): void {
		if (listener.exitArgumentList) listener.exitArgumentList(this);
	}
	@Override
	public accept<Result>(visitor: mongoVisitor<Result>): Result {
		if (visitor.visitArgumentList) return visitor.visitArgumentList(this);
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
	@Override public get ruleIndex(): number { return mongoParser.RULE_objectLiteral; }
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
	@Override public get ruleIndex(): number { return mongoParser.RULE_arrayLiteral; }
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
	@Override public get ruleIndex(): number { return mongoParser.RULE_elementList; }
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
	@Override public get ruleIndex(): number { return mongoParser.RULE_propertyNameAndValueList; }
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
	@Override public get ruleIndex(): number { return mongoParser.RULE_propertyAssignment; }
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
	@Override public get ruleIndex(): number { return mongoParser.RULE_propertyValue; }
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
	public NullLiteral(): TerminalNode | undefined { return this.tryGetToken(mongoParser.NullLiteral, 0); }
	public BooleanLiteral(): TerminalNode | undefined { return this.tryGetToken(mongoParser.BooleanLiteral, 0); }
	public StringLiteral(): TerminalNode | undefined { return this.tryGetToken(mongoParser.StringLiteral, 0); }
	public NumericLiteral(): TerminalNode | undefined { return this.tryGetToken(mongoParser.NumericLiteral, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return mongoParser.RULE_literal; }
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
	public StringLiteral(): TerminalNode { return this.getToken(mongoParser.StringLiteral, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return mongoParser.RULE_propertyName; }
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
	public SingleLineComment(): TerminalNode | undefined { return this.tryGetToken(mongoParser.SingleLineComment, 0); }
	public MultiLineComment(): TerminalNode | undefined { return this.tryGetToken(mongoParser.MultiLineComment, 0); }
	constructor(parent: ParserRuleContext, invokingState: number);
	constructor(parent: ParserRuleContext, invokingState: number) {
		super(parent, invokingState);

	}
	@Override public get ruleIndex(): number { return mongoParser.RULE_comment; }
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


