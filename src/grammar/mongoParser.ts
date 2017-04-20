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
	public static readonly COMMAND_DELIMITTER=2;
	public static readonly EOL=3;
	public static readonly DOT=4;
	public static readonly DB=5;
	public static readonly STRING_LITERAL=6;
	public static readonly WHITESPACE=7;
	public static readonly RULE_mongoCommands = 0;
	public static readonly RULE_commands = 1;
	public static readonly RULE_command = 2;
	public static readonly RULE_functionCall = 3;
	public static readonly ruleNames: string[] = [
		"mongoCommands", "commands", "command", "functionCall"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'()'", "';'", undefined, "'.'", "'db'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, undefined, "COMMAND_DELIMITTER", "EOL", "DOT", "DB", "STRING_LITERAL", 
		"WHITESPACE"
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
			this.state = 8;
			this.commands();
			this.state = 9;
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
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 11;
			this.command();
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
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 13;
			this.match(mongoParser.DB);
			this.state = 14;
			this.match(mongoParser.DOT);
			this.state = 19;
			this._errHandler.sync(this);
			switch ( this.interpreter.adaptivePredict(this._input,0,this._ctx) ) {
			case 1:
				{
				this.state = 15;
				this.functionCall();
				}
				break;

			case 2:
				{
				{
				this.state = 16;
				this.match(mongoParser.STRING_LITERAL);
				this.state = 17;
				this.match(mongoParser.DOT);
				this.state = 18;
				this.functionCall();
				}
				}
				break;
			}
			this.state = 21;
			_la = this._input.LA(1);
			if ( !(_la===mongoParser.COMMAND_DELIMITTER || _la===mongoParser.EOL) ) {
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
	@RuleVersion(0)
	public functionCall(): FunctionCallContext {
		let _localctx: FunctionCallContext = new FunctionCallContext(this._ctx, this.state);
		this.enterRule(_localctx, 6, mongoParser.RULE_functionCall);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 23;
			this.match(mongoParser.STRING_LITERAL);
			this.state = 24;
			this.match(mongoParser.T__0);
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
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x03\t\x1D\x04\x02"+
		"\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x03\x02\x03\x02\x03\x02"+
		"\x03\x03\x03\x03\x03\x04\x03\x04\x03\x04\x03\x04\x03\x04\x03\x04\x05\x04"+
		"\x16\n\x04\x03\x04\x03\x04\x03\x05\x03\x05\x03\x05\x03\x05\x02\x02\x02"+
		"\x06\x02\x02\x04\x02\x06\x02\b\x02\x02\x03\x03\x02\x04\x05\x19\x02\n\x03"+
		"\x02\x02\x02\x04\r\x03\x02\x02\x02\x06\x0F\x03\x02\x02\x02\b\x19\x03\x02"+
		"\x02\x02\n\v\x05\x04\x03\x02\v\f\x07\x02\x02\x03\f\x03\x03\x02\x02\x02"+
		"\r\x0E\x05\x06\x04\x02\x0E\x05\x03\x02\x02\x02\x0F\x10\x07\x07\x02\x02"+
		"\x10\x15\x07\x06\x02\x02\x11\x16\x05\b\x05\x02\x12\x13\x07\b\x02\x02\x13"+
		"\x14\x07\x06\x02\x02\x14\x16\x05\b\x05\x02\x15\x11\x03\x02\x02\x02\x15"+
		"\x12\x03\x02\x02\x02\x16\x17\x03\x02\x02\x02\x17\x18\t\x02\x02\x02\x18"+
		"\x07\x03\x02\x02\x02\x19\x1A\x07\b\x02\x02\x1A\x1B\x07\x03\x02\x02\x1B"+
		"\t\x03\x02\x02\x02\x03\x15";
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
	public command(): CommandContext {
		return this.getRuleContext(0, CommandContext);
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
	public COMMAND_DELIMITTER(): TerminalNode | undefined { return this.tryGetToken(mongoParser.COMMAND_DELIMITTER, 0); }
	public EOL(): TerminalNode | undefined { return this.tryGetToken(mongoParser.EOL, 0); }
	public functionCall(): FunctionCallContext | undefined {
		return this.tryGetRuleContext(0, FunctionCallContext);
	}
	public STRING_LITERAL(): TerminalNode | undefined { return this.tryGetToken(mongoParser.STRING_LITERAL, 0); }
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


export class FunctionCallContext extends ParserRuleContext {
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


