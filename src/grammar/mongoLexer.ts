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
	public static readonly Comment=2;
	public static readonly SingleLineComment=3;
	public static readonly MultiLineComment=4;
	public static readonly COMMAND_DELIMITTER=5;
	public static readonly DOT=6;
	public static readonly DB=7;
	public static readonly LF=8;
	public static readonly CRLF=9;
	public static readonly STRING_LITERAL=10;
	public static readonly WHITESPACE=11;
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"T__0", "Comment", "SingleLineComment", "MultiLineComment", "COMMAND_DELIMITTER", 
		"DOT", "DB", "LF", "CRLF", "STRING_LITERAL", "STRING_ESCAPE", "WHITESPACE"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'()'", undefined, undefined, undefined, undefined, "'.'", 
		"'db'", "'\n'", "'\r\n'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, undefined, "Comment", "SingleLineComment", "MultiLineComment", 
		"COMMAND_DELIMITTER", "DOT", "DB", "LF", "CRLF", "STRING_LITERAL", "WHITESPACE"
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
		case 9:
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
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\r[\b\x01\x04"+
		"\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04"+
		"\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r"+
		"\x03\x02\x03\x02\x03\x02\x03\x03\x03\x03\x05\x03!\n\x03\x03\x04\x03\x04"+
		"\x03\x04\x03\x04\x07\x04\'\n\x04\f\x04\x0E\x04*\v\x04\x03\x04\x03\x04"+
		"\x03\x05\x03\x05\x03\x05\x03\x05\x07\x052\n\x05\f\x05\x0E\x055\v\x05\x03"+
		"\x05\x03\x05\x03\x05\x03\x05\x03\x05\x03\x06\x03\x06\x03\x06\x03\x06\x03"+
		"\x06\x05\x06A\n\x06\x03\x07\x03\x07\x03\b\x03\b\x03\b\x03\t\x03\t\x03"+
		"\n\x03\n\x03\n\x03\v\x03\v\x06\vO\n\v\r\v\x0E\vP\x03\v\x03\v\x03\f\x03"+
		"\f\x03\f\x03\r\x03\r\x03\r\x03\r\x033\x02\x02\x0E\x03\x02\x03\x05\x02"+
		"\x04\x07\x02\x05\t\x02\x06\v\x02\x07\r\x02\b\x0F\x02\t\x11\x02\n\x13\x02"+
		"\v\x15\x02\f\x17\x02\x02\x19\x02\r\x03\x02\x06\x05\x02\f\f\x0F\x0F\u202A"+
		"\u202B\t\x02\v\f\"\"$$*+00<=^^\x04\x02$$^^\x04\x02\v\v\"\"a\x02\x03\x03"+
		"\x02\x02\x02\x02\x05\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02\x02\t\x03"+
		"\x02\x02\x02\x02\v\x03\x02\x02\x02\x02\r\x03\x02\x02\x02\x02\x0F\x03\x02"+
		"\x02\x02\x02\x11\x03\x02\x02\x02\x02\x13\x03\x02\x02\x02\x02\x15\x03\x02"+
		"\x02\x02\x02\x19\x03\x02\x02\x02\x03\x1B\x03\x02\x02\x02\x05 \x03\x02"+
		"\x02\x02\x07\"\x03\x02\x02\x02\t-\x03\x02\x02\x02\v@\x03\x02\x02\x02\r"+
		"B\x03\x02\x02\x02\x0FD\x03\x02\x02\x02\x11G\x03\x02\x02\x02\x13I\x03\x02"+
		"\x02\x02\x15N\x03\x02\x02\x02\x17T\x03\x02\x02\x02\x19W\x03\x02\x02\x02"+
		"\x1B\x1C\x07*\x02\x02\x1C\x1D\x07+\x02\x02\x1D\x04\x03\x02\x02\x02\x1E"+
		"!\x05\x07\x04\x02\x1F!\x05\t\x05\x02 \x1E\x03\x02\x02\x02 \x1F\x03\x02"+
		"\x02\x02!\x06\x03\x02\x02\x02\"#\x071\x02\x02#$\x071\x02\x02$(\x03\x02"+
		"\x02\x02%\'\n\x02\x02\x02&%\x03\x02\x02\x02\'*\x03\x02\x02\x02(&\x03\x02"+
		"\x02\x02()\x03\x02\x02\x02)+\x03\x02\x02\x02*(\x03\x02\x02\x02+,\b\x04"+
		"\x02\x02,\b\x03\x02\x02\x02-.\x071\x02\x02./\x07,\x02\x02/3\x03\x02\x02"+
		"\x0202\v\x02\x02\x0210\x03\x02\x02\x0225\x03\x02\x02\x0234\x03\x02\x02"+
		"\x0231\x03\x02\x02\x0246\x03\x02\x02\x0253\x03\x02\x02\x0267\x07,\x02"+
		"\x0278\x071\x02\x0289\x03\x02\x02\x029:\b\x05\x02\x02:\n\x03\x02\x02\x02"+
		";A\x07=\x02\x02<=\x07=\x02\x02=A\x07\f\x02\x02>A\x05\x11\t\x02?A\x05\x13"+
		"\n\x02@;\x03\x02\x02\x02@<\x03\x02\x02\x02@>\x03\x02\x02\x02@?\x03\x02"+
		"\x02\x02A\f\x03\x02\x02\x02BC\x070\x02\x02C\x0E\x03\x02\x02\x02DE\x07"+
		"f\x02\x02EF\x07d\x02\x02F\x10\x03\x02\x02\x02GH\x07\f\x02\x02H\x12\x03"+
		"\x02\x02\x02IJ\x07\x0F\x02\x02JK\x07\f\x02\x02K\x14\x03\x02\x02\x02LO"+
		"\n\x03\x02\x02MO\x05\x17\f\x02NL\x03\x02\x02\x02NM\x03\x02\x02\x02OP\x03"+
		"\x02\x02\x02PN\x03\x02\x02\x02PQ\x03\x02\x02\x02QR\x03\x02\x02\x02RS\x06"+
		"\v\x02\x02S\x16\x03\x02\x02\x02TU\x07^\x02\x02UV\t\x04\x02\x02V\x18\x03"+
		"\x02\x02\x02WX\t\x05\x02\x02XY\x03\x02\x02\x02YZ\b\r\x03\x02Z\x1A\x03"+
		"\x02\x02\x02\t\x02 (3@NP\x04\x02\x03\x02\b\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!mongoLexer.__ATN) {
			mongoLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(mongoLexer._serializedATN));
		}

		return mongoLexer.__ATN;
	}

}

