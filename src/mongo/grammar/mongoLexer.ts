// Generated from ./grammar/mongo.g4 by ANTLR 4.6-SNAPSHOT


/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
	public static readonly STRING_LITERAL=20;
	public static readonly DOUBLE_QUOTED_STRING_LITERAL=21;
	public static readonly SINGLE_QUOTED_STRING_LITERAL=22;
	public static readonly WHITESPACE=23;
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"T__0", "T__1", "T__2", "T__3", "T__4", "T__5", "T__6", "T__7", "SingleLineComment", 
		"MultiLineComment", "StringLiteral", "NullLiteral", "BooleanLiteral", 
		"NumericLiteral", "DecimalLiteral", "LineTerminator", "SEMICOLON", "DOT", 
		"DB", "STRING_LITERAL", "DOUBLE_QUOTED_STRING_LITERAL", "SINGLE_QUOTED_STRING_LITERAL", 
		"STRING_ESCAPE", "DecimalIntegerLiteral", "ExponentPart", "DecimalDigit", 
		"WHITESPACE"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'('", "','", "')'", "'{'", "'}'", "'['", "']'", "':'", undefined, 
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
			return !this.isExternalIdentifierText(this.text)
				;
		}
		return true;
	}

	public static readonly _serializedATN: string =
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\x19\xD8\b\x01"+
		"\x04\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06"+
		"\x04\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r"+
		"\t\r\x04\x0E\t\x0E\x04\x0F\t\x0F\x04\x10\t\x10\x04\x11\t\x11\x04\x12\t"+
		"\x12\x04\x13\t\x13\x04\x14\t\x14\x04\x15\t\x15\x04\x16\t\x16\x04\x17\t"+
		"\x17\x04\x18\t\x18\x04\x19\t\x19\x04\x1A\t\x1A\x04\x1B\t\x1B\x04\x1C\t"+
		"\x1C\x03\x02\x03\x02\x03\x03\x03\x03\x03\x04\x03\x04\x03\x05\x03\x05\x03"+
		"\x06\x03\x06\x03\x07\x03\x07\x03\b\x03\b\x03\t\x03\t\x03\n\x03\n\x03\n"+
		"\x03\n\x07\nN\n\n\f\n\x0E\nQ\v\n\x03\n\x03\n\x03\v\x03\v\x03\v\x03\v\x07"+
		"\vY\n\v\f\v\x0E\v\\\v\v\x03\v\x03\v\x03\v\x03\v\x03\v\x03\f\x03\f\x05"+
		"\fe\n\f\x03\r\x03\r\x03\r\x03\r\x03\r\x03\x0E\x03\x0E\x03\x0E\x03\x0E"+
		"\x03\x0E\x03\x0E\x03\x0E\x03\x0E\x03\x0E\x05\x0Eu\n\x0E\x03\x0F\x05\x0F"+
		"x\n\x0F\x03\x0F\x03\x0F\x03\x10\x03\x10\x03\x10\x07\x10\x7F\n\x10\f\x10"+
		"\x0E\x10\x82\v\x10\x03\x10\x05\x10\x85\n\x10\x03\x10\x03\x10\x06\x10\x89"+
		"\n\x10\r\x10\x0E\x10\x8A\x03\x10\x05\x10\x8E\n\x10\x03\x10\x03\x10\x05"+
		"\x10\x92\n\x10\x05\x10\x94\n\x10\x03\x11\x03\x11\x03\x11\x03\x11\x03\x12"+
		"\x03\x12\x03\x13\x03\x13\x03\x14\x03\x14\x03\x14\x03\x15\x03\x15\x06\x15"+
		"\xA3\n\x15\r\x15\x0E\x15\xA4\x03\x15\x03\x15\x03\x16\x03\x16\x03\x16\x07"+
		"\x16\xAC\n\x16\f\x16\x0E\x16\xAF\v\x16\x03\x16\x03\x16\x03\x17\x03\x17"+
		"\x03\x17\x07\x17\xB6\n\x17\f\x17\x0E\x17\xB9\v\x17\x03\x17\x03\x17\x03"+
		"\x18\x03\x18\x03\x18\x03\x19\x03\x19\x03\x19\x07\x19\xC3\n\x19\f\x19\x0E"+
		"\x19\xC6\v\x19\x05\x19\xC8\n\x19\x03\x1A\x03\x1A\x05\x1A\xCC\n\x1A\x03"+
		"\x1A\x06\x1A\xCF\n\x1A\r\x1A\x0E\x1A\xD0\x03\x1B\x03\x1B\x03\x1C\x03\x1C"+
		"\x03\x1C\x03\x1C\x03Z\x02\x02\x1D\x03\x02\x03\x05\x02\x04\x07\x02\x05"+
		"\t\x02\x06\v\x02\x07\r\x02\b\x0F\x02\t\x11\x02\n\x13\x02\v\x15\x02\f\x17"+
		"\x02\r\x19\x02\x0E\x1B\x02\x0F\x1D\x02\x10\x1F\x02\x11!\x02\x12#\x02\x13"+
		"%\x02\x14\'\x02\x15)\x02\x16+\x02\x17-\x02\x18/\x02\x021\x02\x023\x02"+
		"\x025\x02\x027\x02\x19\x03\x02\f\x05\x02\f\f\x0F\x0F\u202A\u202B\f\x02"+
		"\v\f\x0F\x0F\"\"$$*+.0<=^^}}\x7F\x7F\x04\x02$$^^\x04\x02))^^\x05\x02$"+
		"$))^^\x03\x023;\x04\x02GGgg\x04\x02--//\x03\x022;\x04\x02\v\v\"\"\xE9"+
		"\x02\x03\x03\x02\x02\x02\x02\x05\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02"+
		"\x02\t\x03\x02\x02\x02\x02\v\x03\x02\x02\x02\x02\r\x03\x02\x02\x02\x02"+
		"\x0F\x03\x02\x02\x02\x02\x11\x03\x02\x02\x02\x02\x13\x03\x02\x02\x02\x02"+
		"\x15\x03\x02\x02\x02\x02\x17\x03\x02\x02\x02\x02\x19\x03\x02\x02\x02\x02"+
		"\x1B\x03\x02\x02\x02\x02\x1D\x03\x02\x02\x02\x02\x1F\x03\x02\x02\x02\x02"+
		"!\x03\x02\x02\x02\x02#\x03\x02\x02\x02\x02%\x03\x02\x02\x02\x02\'\x03"+
		"\x02\x02\x02\x02)\x03\x02\x02\x02\x02+\x03\x02\x02\x02\x02-\x03\x02\x02"+
		"\x02\x027\x03\x02\x02\x02\x039\x03\x02\x02\x02\x05;\x03\x02\x02\x02\x07"+
		"=\x03\x02\x02\x02\t?\x03\x02\x02\x02\vA\x03\x02\x02\x02\rC\x03\x02\x02"+
		"\x02\x0FE\x03\x02\x02\x02\x11G\x03\x02\x02\x02\x13I\x03\x02\x02\x02\x15"+
		"T\x03\x02\x02\x02\x17d\x03\x02\x02\x02\x19f\x03\x02\x02\x02\x1Bt\x03\x02"+
		"\x02\x02\x1Dw\x03\x02\x02\x02\x1F\x93\x03\x02\x02\x02!\x95\x03\x02\x02"+
		"\x02#\x99\x03\x02\x02\x02%\x9B\x03\x02\x02\x02\'\x9D\x03\x02\x02\x02)"+
		"\xA2\x03\x02\x02\x02+\xA8\x03\x02\x02\x02-\xB2\x03\x02\x02\x02/\xBC\x03"+
		"\x02\x02\x021\xC7\x03\x02\x02\x023\xC9\x03\x02\x02\x025\xD2\x03\x02\x02"+
		"\x027\xD4\x03\x02\x02\x029:\x07*\x02\x02:\x04\x03\x02\x02\x02;<\x07.\x02"+
		"\x02<\x06\x03\x02\x02\x02=>\x07+\x02\x02>\b\x03\x02\x02\x02?@\x07}\x02"+
		"\x02@\n\x03\x02\x02\x02AB\x07\x7F\x02\x02B\f\x03\x02\x02\x02CD\x07]\x02"+
		"\x02D\x0E\x03\x02\x02\x02EF\x07_\x02\x02F\x10\x03\x02\x02\x02GH\x07<\x02"+
		"\x02H\x12\x03\x02\x02\x02IJ\x071\x02\x02JK\x071\x02\x02KO\x03\x02\x02"+
		"\x02LN\n\x02\x02\x02ML\x03\x02\x02\x02NQ\x03\x02\x02\x02OM\x03\x02\x02"+
		"\x02OP\x03\x02\x02\x02PR\x03\x02\x02\x02QO\x03\x02\x02\x02RS\b\n\x02\x02"+
		"S\x14\x03\x02\x02\x02TU\x071\x02\x02UV\x07,\x02\x02VZ\x03\x02\x02\x02"+
		"WY\v\x02\x02\x02XW\x03\x02\x02\x02Y\\\x03\x02\x02\x02Z[\x03\x02\x02\x02"+
		"ZX\x03\x02\x02\x02[]\x03\x02\x02\x02\\Z\x03\x02\x02\x02]^\x07,\x02\x02"+
		"^_\x071\x02\x02_`\x03\x02\x02\x02`a\b\v\x02\x02a\x16\x03\x02\x02\x02b"+
		"e\x05-\x17\x02ce\x05+\x16\x02db\x03\x02\x02\x02dc\x03\x02\x02\x02e\x18"+
		"\x03\x02\x02\x02fg\x07p\x02\x02gh\x07w\x02\x02hi\x07n\x02\x02ij\x07n\x02"+
		"\x02j\x1A\x03\x02\x02\x02kl\x07v\x02\x02lm\x07t\x02\x02mn\x07w\x02\x02"+
		"nu\x07g\x02\x02op\x07h\x02\x02pq\x07c\x02\x02qr\x07n\x02\x02rs\x07u\x02"+
		"\x02su\x07g\x02\x02tk\x03\x02\x02\x02to\x03\x02\x02\x02u\x1C\x03\x02\x02"+
		"\x02vx\x07/\x02\x02wv\x03\x02\x02\x02wx\x03\x02\x02\x02xy\x03\x02\x02"+
		"\x02yz\x05\x1F\x10\x02z\x1E\x03\x02\x02\x02{|\x051\x19\x02|\x80\x070\x02"+
		"\x02}\x7F\x055\x1B\x02~}\x03\x02\x02\x02\x7F\x82\x03\x02\x02\x02\x80~"+
		"\x03\x02\x02\x02\x80\x81\x03\x02\x02\x02\x81\x84\x03\x02\x02\x02\x82\x80"+
		"\x03\x02\x02\x02\x83\x85\x053\x1A\x02\x84\x83\x03\x02\x02\x02\x84\x85"+
		"\x03\x02\x02\x02\x85\x94\x03\x02\x02\x02\x86\x88\x070\x02\x02\x87\x89"+
		"\x055\x1B\x02\x88\x87\x03\x02\x02\x02\x89\x8A\x03\x02\x02\x02\x8A\x88"+
		"\x03\x02\x02\x02\x8A\x8B\x03\x02\x02\x02\x8B\x8D\x03\x02\x02\x02\x8C\x8E"+
		"\x053\x1A\x02\x8D\x8C\x03\x02\x02\x02\x8D\x8E\x03\x02\x02\x02\x8E\x94"+
		"\x03\x02\x02\x02\x8F\x91\x051\x19\x02\x90\x92\x053\x1A\x02\x91\x90\x03"+
		"\x02\x02\x02\x91\x92\x03\x02\x02\x02\x92\x94\x03\x02\x02\x02\x93{\x03"+
		"\x02\x02\x02\x93\x86\x03\x02\x02\x02\x93\x8F\x03\x02\x02\x02\x94 \x03"+
		"\x02\x02\x02\x95\x96\t\x02\x02\x02\x96\x97\x03\x02\x02\x02\x97\x98\b\x11"+
		"\x02\x02\x98\"\x03\x02\x02\x02\x99\x9A\x07=\x02\x02\x9A$\x03\x02\x02\x02"+
		"\x9B\x9C\x070\x02\x02\x9C&\x03\x02\x02\x02\x9D\x9E\x07f\x02\x02\x9E\x9F"+
		"\x07d\x02\x02\x9F(\x03\x02\x02\x02\xA0\xA3\n\x03\x02\x02\xA1\xA3\x05/"+
		"\x18\x02\xA2\xA0\x03\x02\x02\x02\xA2\xA1\x03\x02\x02\x02\xA3\xA4\x03\x02"+
		"\x02\x02\xA4\xA2\x03\x02\x02\x02\xA4\xA5\x03\x02\x02\x02\xA5\xA6\x03\x02"+
		"\x02\x02\xA6\xA7\x06\x15\x02\x02\xA7*\x03\x02\x02\x02\xA8\xAD\x07$\x02"+
		"\x02\xA9\xAC\n\x04\x02\x02\xAA\xAC\x05/\x18\x02\xAB\xA9\x03\x02\x02\x02"+
		"\xAB\xAA\x03\x02\x02\x02\xAC\xAF\x03\x02\x02\x02\xAD\xAB\x03\x02\x02\x02"+
		"\xAD\xAE\x03\x02\x02\x02\xAE\xB0\x03\x02\x02\x02\xAF\xAD\x03\x02\x02\x02"+
		"\xB0\xB1\x07$\x02\x02\xB1,\x03\x02\x02\x02\xB2\xB7\x07)\x02\x02\xB3\xB6"+
		"\n\x05\x02\x02\xB4\xB6\x05/\x18\x02\xB5\xB3\x03\x02\x02\x02\xB5\xB4\x03"+
		"\x02\x02\x02\xB6\xB9\x03\x02\x02\x02\xB7\xB5\x03\x02\x02\x02\xB7\xB8\x03"+
		"\x02\x02\x02\xB8\xBA\x03\x02\x02\x02\xB9\xB7\x03\x02\x02\x02\xBA\xBB\x07"+
		")\x02\x02\xBB.\x03\x02\x02\x02\xBC\xBD\x07^\x02\x02\xBD\xBE\t\x06\x02"+
		"\x02\xBE0\x03\x02\x02\x02\xBF\xC8\x072\x02\x02\xC0\xC4\t\x07\x02\x02\xC1"+
		"\xC3\x055\x1B\x02\xC2\xC1\x03\x02\x02\x02\xC3\xC6\x03\x02\x02\x02\xC4"+
		"\xC2\x03\x02\x02\x02\xC4\xC5\x03\x02\x02\x02\xC5\xC8\x03\x02\x02\x02\xC6"+
		"\xC4\x03\x02\x02\x02\xC7\xBF\x03\x02\x02\x02\xC7\xC0\x03\x02\x02\x02\xC8"+
		"2\x03\x02\x02\x02\xC9\xCB\t\b\x02\x02\xCA\xCC\t\t\x02\x02\xCB\xCA\x03"+
		"\x02\x02\x02\xCB\xCC\x03\x02\x02\x02\xCC\xCE\x03\x02\x02\x02\xCD\xCF\x05"+
		"5\x1B\x02\xCE\xCD\x03\x02\x02\x02\xCF\xD0\x03\x02\x02\x02\xD0\xCE\x03"+
		"\x02\x02\x02\xD0\xD1\x03\x02\x02\x02\xD14\x03\x02\x02\x02\xD2\xD3\t\n"+
		"\x02\x02\xD36\x03\x02\x02\x02\xD4\xD5\t\v\x02\x02\xD5\xD6\x03\x02\x02"+
		"\x02\xD6\xD7\b\x1C\x03\x02\xD78\x03\x02\x02\x02\x18\x02OZdtw\x80\x84\x8A"+
		"\x8D\x91\x93\xA2\xA4\xAB\xAD\xB5\xB7\xC4\xC7\xCB\xD0\x04\x02\x03\x02\b"+
		"\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!mongoLexer.__ATN) {
			mongoLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(mongoLexer._serializedATN));
		}

		return mongoLexer.__ATN;
	}

}

