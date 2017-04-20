// Generated from ./grammar/mongo.g4 by ANTLR 4.6-SNAPSHOT


import { ATN } from 'antlr4ts/atn/ATN';
import { ATNDeserializer } from 'antlr4ts/atn/ATNDeserializer';
import { CharStream } from 'antlr4ts/CharStream';
import { Lexer } from 'antlr4ts/Lexer';
import { LexerATNSimulator } from 'antlr4ts/atn/LexerATNSimulator';
import { NotNull } from 'antlr4ts/Decorators';
import { Override } from 'antlr4ts/Decorators';
import { RuleContext } from 'antlr4ts/RuleContext';
import { Vocabulary } from 'antlr4ts/Vocabulary';
import { VocabularyImpl } from 'antlr4ts/VocabularyImpl';

import * as Utils from 'antlr4ts/misc/Utils';


export class mongoLexer extends Lexer {
	public static readonly T__0=1;
	public static readonly COMMAND_DELIMITTER=2;
	public static readonly DOT=3;
	public static readonly DB=4;
	public static readonly STRING_LITERAL=5;
	public static readonly WHITESPACE=6;
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"T__0", "COMMAND_DELIMITTER", "DOT", "DB", "STRING_LITERAL", "STRING_ESCAPE", 
		"WHITESPACE"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'()'", undefined, "'.'", "'db'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, undefined, "COMMAND_DELIMITTER", "DOT", "DB", "STRING_LITERAL", 
		"WHITESPACE"
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(mongoLexer._LITERAL_NAMES, mongoLexer._SYMBOLIC_NAMES, []);

	@Override
	@NotNull
	public get vocabulary(): Vocabulary {
		return mongoLexer.VOCABULARY;
	}


		private isExternalIdentifierText(text) {
			return text === 'db';
		}


	constructor(input: CharStream) {
		super(input);
		this._interp = new LexerATNSimulator(mongoLexer._ATN, this);
	}

	@Override
	public get grammarFileName(): string { return "mongo.g4"; }

	@Override
	public get ruleNames(): string[] { return mongoLexer.ruleNames; }

	@Override
	public get serializedATN(): string { return mongoLexer._serializedATN; }

	@Override
	public get modeNames(): string[] { return mongoLexer.modeNames; }

	@Override
	public sempred(_localctx: RuleContext, ruleIndex: number, predIndex: number): boolean {
		switch (ruleIndex) {
		case 4:
			return this.STRING_LITERAL_sempred(_localctx, predIndex);
		}
		return true;
	}
	private STRING_LITERAL_sempred(_localctx: RuleContext, predIndex: number): boolean {
		switch (predIndex) {
		case 0:
			return !this.isExternalIdentifierText(this.text);
		}
		return true;
	}

	public static readonly _serializedATN: string =
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\b.\b\x01\x04"+
		"\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04"+
		"\x07\t\x07\x04\b\t\b\x03\x02\x03\x02\x03\x02\x03\x03\x03\x03\x03\x03\x03"+
		"\x03\x05\x03\x19\n\x03\x03\x04\x03\x04\x03\x05\x03\x05\x03\x05\x03\x06"+
		"\x03\x06\x06\x06\"\n\x06\r\x06\x0E\x06#\x03\x06\x03\x06\x03\x07\x03\x07"+
		"\x03\x07\x03\b\x03\b\x03\b\x03\b\x02\x02\x02\t\x03\x02\x03\x05\x02\x04"+
		"\x07\x02\x05\t\x02\x06\v\x02\x07\r\x02\x02\x0F\x02\b\x03\x02\x05\t\x02"+
		"\v\f\"\"$$*+00<=^^\x04\x02$$^^\x04\x02\v\v\"\"0\x02\x03\x03\x02\x02\x02"+
		"\x02\x05\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02\x02\t\x03\x02\x02\x02"+
		"\x02\v\x03\x02\x02\x02\x02\x0F\x03\x02\x02\x02\x03\x11\x03\x02\x02\x02"+
		"\x05\x18\x03\x02\x02\x02\x07\x1A\x03\x02\x02\x02\t\x1C\x03\x02\x02\x02"+
		"\v!\x03\x02\x02\x02\r\'\x03\x02\x02\x02\x0F*\x03\x02\x02\x02\x11\x12\x07"+
		"*\x02\x02\x12\x13\x07+\x02\x02\x13\x04\x03\x02\x02\x02\x14\x19\x07=\x02"+
		"\x02\x15\x16\x07=\x02\x02\x16\x19\x07\f\x02\x02\x17\x19\x07\f\x02\x02"+
		"\x18\x14\x03\x02\x02\x02\x18\x15\x03\x02\x02\x02\x18\x17\x03\x02\x02\x02"+
		"\x19\x06\x03\x02\x02\x02\x1A\x1B\x070\x02\x02\x1B\b\x03\x02\x02\x02\x1C"+
		"\x1D\x07f\x02\x02\x1D\x1E\x07d\x02\x02\x1E\n\x03\x02\x02\x02\x1F\"\n\x02"+
		"\x02\x02 \"\x05\r\x07\x02!\x1F\x03\x02\x02\x02! \x03\x02\x02\x02\"#\x03"+
		"\x02\x02\x02#!\x03\x02\x02\x02#$\x03\x02\x02\x02$%\x03\x02\x02\x02%&\x06"+
		"\x06\x02\x02&\f\x03\x02\x02\x02\'(\x07^\x02\x02()\t\x03\x02\x02)\x0E\x03"+
		"\x02\x02\x02*+\t\x04\x02\x02+,\x03\x02\x02\x02,-\b\b\x02\x02-\x10\x03"+
		"\x02\x02\x02\x06\x02\x18!#\x03\b\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!mongoLexer.__ATN) {
			mongoLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(mongoLexer._serializedATN));
		}

		return mongoLexer.__ATN;
	}

}

