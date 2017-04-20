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
	public static readonly EOL=3;
	public static readonly DOT=4;
	public static readonly DB=5;
	public static readonly STRING_LITERAL=6;
	public static readonly WHITESPACE=7;
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"T__0", "COMMAND_DELIMITTER", "EOL", "DOT", "DB", "STRING_LITERAL", "STRING_ESCAPE", 
		"WHITESPACE"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'()'", "';'", undefined, "'.'", "'db'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, undefined, "COMMAND_DELIMITTER", "EOL", "DOT", "DB", "STRING_LITERAL", 
		"WHITESPACE"
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(mongoLexer._LITERAL_NAMES, mongoLexer._SYMBOLIC_NAMES, []);

	@Override
	@NotNull
	public get vocabulary(): Vocabulary {
		return mongoLexer.VOCABULARY;
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

	public static readonly _serializedATN: string =
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\t,\b\x01\x04"+
		"\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04"+
		"\x07\t\x07\x04\b\t\b\x04\t\t\t\x03\x02\x03\x02\x03\x02\x03\x03\x03\x03"+
		"\x03\x04\x03\x04\x03\x05\x03\x05\x03\x06\x03\x06\x03\x06\x03\x07\x03\x07"+
		"\x06\x07\"\n\x07\r\x07\x0E\x07#\x03\b\x03\b\x03\b\x03\t\x03\t\x03\t\x03"+
		"\t\x02\x02\x02\n\x03\x02\x03\x05\x02\x04\x07\x02\x05\t\x02\x06\v\x02\x07"+
		"\r\x02\b\x0F\x02\x02\x11\x02\t\x03\x02\x06\x03\x02\f\f\v\x02\v\v\"\"$"+
		"$))00<<^^ddff\x04\x02$$^^\x05\x02\v\f\x0F\x0F\"\",\x02\x03\x03\x02\x02"+
		"\x02\x02\x05\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02\x02\t\x03\x02\x02"+
		"\x02\x02\v\x03\x02\x02\x02\x02\r\x03\x02\x02\x02\x02\x11\x03\x02\x02\x02"+
		"\x03\x13\x03\x02\x02\x02\x05\x16\x03\x02\x02\x02\x07\x18\x03\x02\x02\x02"+
		"\t\x1A\x03\x02\x02\x02\v\x1C\x03\x02\x02\x02\r!\x03\x02\x02\x02\x0F%\x03"+
		"\x02\x02\x02\x11(\x03\x02\x02\x02\x13\x14\x07*\x02\x02\x14\x15\x07+\x02"+
		"\x02\x15\x04\x03\x02\x02\x02\x16\x17\x07=\x02\x02\x17\x06\x03\x02\x02"+
		"\x02\x18\x19\t\x02\x02\x02\x19\b\x03\x02\x02\x02\x1A\x1B\x070\x02\x02"+
		"\x1B\n\x03\x02\x02\x02\x1C\x1D\x07f\x02\x02\x1D\x1E\x07d\x02\x02\x1E\f"+
		"\x03\x02\x02\x02\x1F\"\n\x03\x02\x02 \"\x05\x0F\b\x02!\x1F\x03\x02\x02"+
		"\x02! \x03\x02\x02\x02\"#\x03\x02\x02\x02#!\x03\x02\x02\x02#$\x03\x02"+
		"\x02\x02$\x0E\x03\x02\x02\x02%&\x07^\x02\x02&\'\t\x04\x02\x02\'\x10\x03"+
		"\x02\x02\x02()\t\x05\x02\x02)*\x03\x02\x02\x02*+\b\t\x02\x02+\x12\x03"+
		"\x02\x02\x02\x05\x02!#\x03\b\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!mongoLexer.__ATN) {
			mongoLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(mongoLexer._serializedATN));
		}

		return mongoLexer.__ATN;
	}

}

