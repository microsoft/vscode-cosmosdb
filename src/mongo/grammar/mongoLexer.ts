// Generated from ./grammar/mongo.g4 by ANTLR 4.6-SNAPSHOT
/*tslint:disable */


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
	public static readonly T__0 = 1;
	public static readonly T__1 = 2;
	public static readonly T__2 = 3;
	public static readonly T__3 = 4;
	public static readonly T__4 = 5;
	public static readonly T__5 = 6;
	public static readonly T__6 = 7;
	public static readonly T__7 = 8;
	public static readonly SingleLineComment = 9;
	public static readonly MultiLineComment = 10;
	public static readonly StringLiteral = 11;
	public static readonly NullLiteral = 12;
	public static readonly BooleanLiteral = 13;
	public static readonly NumericLiteral = 14;
	public static readonly DecimalLiteral = 15;
	public static readonly LineTerminator = 16;
	public static readonly SEMICOLON = 17;
	public static readonly DOT = 18;
	public static readonly DB = 19;
	public static readonly LF = 20;
	public static readonly CRLF = 21;
	public static readonly STRING_LITERAL = 22;
	public static readonly DOUBLE_QUOTED_STRING_LITERAL = 23;
	public static readonly SINGLE_QUOTED_STRING_LITERAL = 24;
	public static readonly WHITESPACE = 25;
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"T__0", "T__1", "T__2", "T__3", "T__4", "T__5", "T__6", "T__7", "SingleLineComment",
		"MultiLineComment", "StringLiteral", "NullLiteral", "BooleanLiteral",
		"NumericLiteral", "DecimalLiteral", "LineTerminator", "SEMICOLON", "DOT",
		"DB", "LF", "CRLF", "STRING_LITERAL", "DOUBLE_QUOTED_STRING_LITERAL",
		"SINGLE_QUOTED_STRING_LITERAL", "STRING_ESCAPE", "DecimalIntegerLiteral",
		"ExponentPart", "DecimalDigit", "WHITESPACE"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'('", "')'", "'{'", "','", "'}'", "'['", "']'", "':'", undefined,
		undefined, undefined, "'null'", undefined, undefined, undefined, undefined,
		"';'", "'.'", "'db'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, undefined, undefined, undefined, undefined, undefined, undefined,
		undefined, undefined, "SingleLineComment", "MultiLineComment", "StringLiteral",
		"NullLiteral", "BooleanLiteral", "NumericLiteral", "DecimalLiteral", "LineTerminator",
		"SEMICOLON", "DOT", "DB", "STRING_LITERAL", "DOUBLE_QUOTED_STRING_LITERAL",
		"SINGLE_QUOTED_STRING_LITERAL", "WHITESPACE"
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
			case 19:
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
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\x1B\xE1\b\x01" +
		"\x04\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06" +
		"\x04\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r" +
		"\t\r\x04\x0E\t\x0E\x04\x0F\t\x0F\x04\x10\t\x10\x04\x11\t\x11\x04\x12\t" +
		"\x12\x04\x13\t\x13\x04\x14\t\x14\x04\x15\t\x15\x04\x16\t\x16\x04\x17\t" +
		"\x17\x04\x18\t\x18\x04\x19\t\x19\x04\x1A\t\x1A\x04\x1B\t\x1B\x04\x1C\t" +
		"\x1C\x04\x1D\t\x1D\x04\x1E\t\x1E\x03\x02\x03\x02\x03\x03\x03\x03\x03\x04" +
		"\x03\x04\x03\x05\x03\x05\x03\x06\x03\x06\x03\x07\x03\x07\x03\b\x03\b\x03" +
		"\t\x03\t\x03\n\x03\n\x03\n\x03\n\x07\nR\n\n\f\n\x0E\nU\v\n\x03\n\x03\n" +
		"\x03\v\x03\v\x03\v\x03\v\x07\v]\n\v\f\v\x0E\v`\v\v\x03\v\x03\v\x03\v\x03" +
		"\v\x03\v\x03\f\x03\f\x05\fi\n\f\x03\r\x03\r\x03\r\x03\r\x03\r\x03\x0E" +
		"\x03\x0E\x03\x0E\x03\x0E\x03\x0E\x03\x0E\x03\x0E\x03\x0E\x03\x0E\x05\x0E" +
		"y\n\x0E\x03\x0F\x05\x0F|\n\x0F\x03\x0F\x03\x0F\x03\x10\x03\x10\x03\x10" +
		"\x07\x10\x83\n\x10\f\x10\x0E\x10\x86\v\x10\x03\x10\x05\x10\x89\n\x10\x03" +
		"\x10\x03\x10\x06\x10\x8D\n\x10\r\x10\x0E\x10\x8E\x03\x10\x05\x10\x92\n" +
		"\x10\x03\x10\x03\x10\x05\x10\x96\n\x10\x05\x10\x98\n\x10\x03\x11\x03\x11" +
		"\x03\x11\x03\x11\x03\x12\x03\x12\x03\x13\x03\x13\x03\x14\x03\x14\x03\x14" +
		"\x03\x15\x03\x15\x03\x16\x03\x16\x03\x16\x03\x17\x03\x17\x06\x17\xAC\n" +
		"\x17\r\x17\x0E\x17\xAD\x03\x17\x03\x17\x03\x18\x03\x18\x03\x18\x07\x18" +
		"\xB5\n\x18\f\x18\x0E\x18\xB8\v\x18\x03\x18\x03\x18\x03\x19\x03\x19\x03" +
		"\x19\x07\x19\xBF\n\x19\f\x19\x0E\x19\xC2\v\x19\x03\x19\x03\x19\x03\x1A" +
		"\x03\x1A\x03\x1A\x03\x1B\x03\x1B\x03\x1B\x07\x1B\xCC\n\x1B\f\x1B\x0E\x1B" +
		"\xCF\v\x1B\x05\x1B\xD1\n\x1B\x03\x1C\x03\x1C\x05\x1C\xD5\n\x1C\x03\x1C" +
		"\x06\x1C\xD8\n\x1C\r\x1C\x0E\x1C\xD9\x03\x1D\x03\x1D\x03\x1E\x03\x1E\x03" +
		"\x1E\x03\x1E\x03^\x02\x02\x1F\x03\x02\x03\x05\x02\x04\x07\x02\x05\t\x02" +
		"\x06\v\x02\x07\r\x02\b\x0F\x02\t\x11\x02\n\x13\x02\v\x15\x02\f\x17\x02" +
		"\r\x19\x02\x0E\x1B\x02\x0F\x1D\x02\x10\x1F\x02\x11!\x02\x12#\x02\x13%" +
		"\x02\x14\'\x02\x15)\x02\x16+\x02\x17-\x02\x18/\x02\x191\x02\x1A3\x02\x02" +
		"5\x02\x027\x02\x029\x02\x02;\x02\x1B\x03\x02\f\x05\x02\f\f\x0F\x0F\u202A" +
		"\u202B\v\x02\v\f\"\"$$*+.0<=^^}}\x7F\x7F\x04\x02$$^^\x04\x02))^^\x05\x02" +
		"$$))^^\x03\x023;\x04\x02GGgg\x04\x02--//\x03\x022;\x04\x02\v\v\"\"\xF2" +
		"\x02\x03\x03\x02\x02\x02\x02\x05\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02" +
		"\x02\t\x03\x02\x02\x02\x02\v\x03\x02\x02\x02\x02\r\x03\x02\x02\x02\x02" +
		"\x0F\x03\x02\x02\x02\x02\x11\x03\x02\x02\x02\x02\x13\x03\x02\x02\x02\x02" +
		"\x15\x03\x02\x02\x02\x02\x17\x03\x02\x02\x02\x02\x19\x03\x02\x02\x02\x02" +
		"\x1B\x03\x02\x02\x02\x02\x1D\x03\x02\x02\x02\x02\x1F\x03\x02\x02\x02\x02" +
		"!\x03\x02\x02\x02\x02#\x03\x02\x02\x02\x02%\x03\x02\x02\x02\x02\'\x03" +
		"\x02\x02\x02\x02)\x03\x02\x02\x02\x02+\x03\x02\x02\x02\x02-\x03\x02\x02" +
		"\x02\x02/\x03\x02\x02\x02\x021\x03\x02\x02\x02\x02;\x03\x02\x02\x02\x03" +
		"=\x03\x02\x02\x02\x05?\x03\x02\x02\x02\x07A\x03\x02\x02\x02\tC\x03\x02" +
		"\x02\x02\vE\x03\x02\x02\x02\rG\x03\x02\x02\x02\x0FI\x03\x02\x02\x02\x11" +
		"K\x03\x02\x02\x02\x13M\x03\x02\x02\x02\x15X\x03\x02\x02\x02\x17h\x03\x02" +
		"\x02\x02\x19j\x03\x02\x02\x02\x1Bx\x03\x02\x02\x02\x1D{\x03\x02\x02\x02" +
		"\x1F\x97\x03\x02\x02\x02!\x99\x03\x02\x02\x02#\x9D\x03\x02\x02\x02%\x9F" +
		"\x03\x02\x02\x02\'\xA1\x03\x02\x02\x02)\xA4\x03\x02\x02\x02+\xA6\x03\x02" +
		"\x02\x02-\xAB\x03\x02\x02\x02/\xB1\x03\x02\x02\x021\xBB\x03\x02\x02\x02" +
		"3\xC5\x03\x02\x02\x025\xD0\x03\x02\x02\x027\xD2\x03\x02\x02\x029\xDB\x03" +
		"\x02\x02\x02;\xDD\x03\x02\x02\x02=>\x07*\x02\x02>\x04\x03\x02\x02\x02" +
		"?@\x07+\x02\x02@\x06\x03\x02\x02\x02AB\x07}\x02\x02B\b\x03\x02\x02\x02" +
		"CD\x07.\x02\x02D\n\x03\x02\x02\x02EF\x07\x7F\x02\x02F\f\x03\x02\x02\x02" +
		"GH\x07]\x02\x02H\x0E\x03\x02\x02\x02IJ\x07_\x02\x02J\x10\x03\x02\x02\x02" +
		"KL\x07<\x02\x02L\x12\x03\x02\x02\x02MN\x071\x02\x02NO\x071\x02\x02OS\x03" +
		"\x02\x02\x02PR\n\x02\x02\x02QP\x03\x02\x02\x02RU\x03\x02\x02\x02SQ\x03" +
		"\x02\x02\x02ST\x03\x02\x02\x02TV\x03\x02\x02\x02US\x03\x02\x02\x02VW\b" +
		"\n\x02\x02W\x14\x03\x02\x02\x02XY\x071\x02\x02YZ\x07,\x02\x02Z^\x03\x02" +
		"\x02\x02[]\v\x02\x02\x02\\[\x03\x02\x02\x02]`\x03\x02\x02\x02^_\x03\x02" +
		"\x02\x02^\\\x03\x02\x02\x02_a\x03\x02\x02\x02`^\x03\x02\x02\x02ab\x07" +
		",\x02\x02bc\x071\x02\x02cd\x03\x02\x02\x02de\b\v\x02\x02e\x16\x03\x02" +
		"\x02\x02fi\x051\x19\x02gi\x05/\x18\x02hf\x03\x02\x02\x02hg\x03\x02\x02" +
		"\x02i\x18\x03\x02\x02\x02jk\x07p\x02\x02kl\x07w\x02\x02lm\x07n\x02\x02" +
		"mn\x07n\x02\x02n\x1A\x03\x02\x02\x02op\x07v\x02\x02pq\x07t\x02\x02qr\x07" +
		"w\x02\x02ry\x07g\x02\x02st\x07h\x02\x02tu\x07c\x02\x02uv\x07n\x02\x02" +
		"vw\x07u\x02\x02wy\x07g\x02\x02xo\x03\x02\x02\x02xs\x03\x02\x02\x02y\x1C" +
		"\x03\x02\x02\x02z|\x07/\x02\x02{z\x03\x02\x02\x02{|\x03\x02\x02\x02|}" +
		"\x03\x02\x02\x02}~\x05\x1F\x10\x02~\x1E\x03\x02\x02\x02\x7F\x80\x055\x1B" +
		"\x02\x80\x84\x070\x02\x02\x81\x83\x059\x1D\x02\x82\x81\x03\x02\x02\x02" +
		"\x83\x86\x03\x02\x02\x02\x84\x82\x03\x02\x02\x02\x84\x85\x03\x02\x02\x02" +
		"\x85\x88\x03\x02\x02\x02\x86\x84\x03\x02\x02\x02\x87\x89\x057\x1C\x02" +
		"\x88\x87\x03\x02\x02\x02\x88\x89\x03\x02\x02\x02\x89\x98\x03\x02\x02\x02" +
		"\x8A\x8C\x070\x02\x02\x8B\x8D\x059\x1D\x02\x8C\x8B\x03\x02\x02\x02\x8D" +
		"\x8E\x03\x02\x02\x02\x8E\x8C\x03\x02\x02\x02\x8E\x8F\x03\x02\x02\x02\x8F" +
		"\x91\x03\x02\x02\x02\x90\x92\x057\x1C\x02\x91\x90\x03\x02\x02\x02\x91" +
		"\x92\x03\x02\x02\x02\x92\x98\x03\x02\x02\x02\x93\x95\x055\x1B\x02\x94" +
		"\x96\x057\x1C\x02\x95\x94\x03\x02\x02\x02\x95\x96\x03\x02\x02\x02\x96" +
		"\x98\x03\x02\x02\x02\x97\x7F\x03\x02\x02\x02\x97\x8A\x03\x02\x02\x02\x97" +
		"\x93\x03\x02\x02\x02\x98 \x03\x02\x02\x02\x99\x9A\t\x02\x02\x02\x9A\x9B" +
		"\x03\x02\x02\x02\x9B\x9C\b\x11\x02\x02\x9C\"\x03\x02\x02\x02\x9D\x9E\x07" +
		"=\x02\x02\x9E$\x03\x02\x02\x02\x9F\xA0\x070\x02\x02\xA0&\x03\x02\x02\x02" +
		"\xA1\xA2\x07f\x02\x02\xA2\xA3\x07d\x02\x02\xA3(\x03\x02\x02\x02\xA4\xA5" +
		"\x07\f\x02\x02\xA5*\x03\x02\x02\x02\xA6\xA7\x07\x0F\x02\x02\xA7\xA8\x07" +
		"\f\x02\x02\xA8,\x03\x02\x02\x02\xA9\xAC\n\x03\x02\x02\xAA\xAC\x053\x1A" +
		"\x02\xAB\xA9\x03\x02\x02\x02\xAB\xAA\x03\x02\x02\x02\xAC\xAD\x03\x02\x02" +
		"\x02\xAD\xAB\x03\x02\x02\x02\xAD\xAE\x03\x02\x02\x02\xAE\xAF\x03\x02\x02" +
		"\x02\xAF\xB0\x06\x17\x02\x02\xB0.\x03\x02\x02\x02\xB1\xB6\x07$\x02\x02" +
		"\xB2\xB5\n\x04\x02\x02\xB3\xB5\x053\x1A\x02\xB4\xB2\x03\x02\x02\x02\xB4" +
		"\xB3\x03\x02\x02\x02\xB5\xB8\x03\x02\x02\x02\xB6\xB4\x03\x02\x02\x02\xB6" +
		"\xB7\x03\x02\x02\x02\xB7\xB9\x03\x02\x02\x02\xB8\xB6\x03\x02\x02\x02\xB9" +
		"\xBA\x07$\x02\x02\xBA0\x03\x02\x02\x02\xBB\xC0\x07)\x02\x02\xBC\xBF\n" +
		"\x05\x02\x02\xBD\xBF\x053\x1A\x02\xBE\xBC\x03\x02\x02\x02\xBE\xBD\x03" +
		"\x02\x02\x02\xBF\xC2\x03\x02\x02\x02\xC0\xBE\x03\x02\x02\x02\xC0\xC1\x03" +
		"\x02\x02\x02\xC1\xC3\x03\x02\x02\x02\xC2\xC0\x03\x02\x02\x02\xC3\xC4\x07" +
		")\x02\x02\xC42\x03\x02\x02\x02\xC5\xC6\x07^\x02\x02\xC6\xC7\t\x06\x02" +
		"\x02\xC74\x03\x02\x02\x02\xC8\xD1\x072\x02\x02\xC9\xCD\t\x07\x02\x02\xCA" +
		"\xCC\x059\x1D\x02\xCB\xCA\x03\x02\x02\x02\xCC\xCF\x03\x02\x02\x02\xCD" +
		"\xCB\x03\x02\x02\x02\xCD\xCE\x03\x02\x02\x02\xCE\xD1\x03\x02\x02\x02\xCF" +
		"\xCD\x03\x02\x02\x02\xD0\xC8\x03\x02\x02\x02\xD0\xC9\x03\x02\x02\x02\xD1" +
		"6\x03\x02\x02\x02\xD2\xD4\t\b\x02\x02\xD3\xD5\t\t\x02\x02\xD4\xD3\x03" +
		"\x02\x02\x02\xD4\xD5\x03\x02\x02\x02\xD5\xD7\x03\x02\x02\x02\xD6\xD8\x05" +
		"9\x1D\x02\xD7\xD6\x03\x02\x02\x02\xD8\xD9\x03\x02\x02\x02\xD9\xD7\x03" +
		"\x02\x02\x02\xD9\xDA\x03\x02\x02\x02\xDA8\x03\x02\x02\x02\xDB\xDC\t\n" +
		"\x02\x02\xDC:\x03\x02\x02\x02\xDD\xDE\t\v\x02\x02\xDE\xDF\x03\x02\x02" +
		"\x02\xDF\xE0\b\x1E\x03\x02\xE0<\x03\x02\x02\x02\x18\x02S^hx{\x84\x88\x8E" +
		"\x91\x95\x97\xAB\xAD\xB4\xB6\xBE\xC0\xCD\xD0\xD4\xD9\x04\x02\x03\x02\b" +
		"\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!mongoLexer.__ATN) {
			mongoLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(mongoLexer._serializedATN));
		}

		return mongoLexer.__ATN;
	}

}

