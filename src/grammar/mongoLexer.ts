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
	public static readonly EOL=8;
	public static readonly STRING_LITERAL=9;
	public static readonly WHITESPACE=10;
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE"
	];

	public static readonly ruleNames: string[] = [
		"T__0", "Comment", "SingleLineComment", "MultiLineComment", "COMMAND_DELIMITTER", 
		"DOT", "DB", "EOL", "STRING_LITERAL", "STRING_ESCAPE", "WHITESPACE"
	];

	private static readonly _LITERAL_NAMES: (string | undefined)[] = [
		undefined, "'()'", undefined, undefined, undefined, undefined, "'.'", 
		"'db'", "'\n'"
	];
	private static readonly _SYMBOLIC_NAMES: (string | undefined)[] = [
		undefined, undefined, "Comment", "SingleLineComment", "MultiLineComment", 
		"COMMAND_DELIMITTER", "DOT", "DB", "EOL", "STRING_LITERAL", "WHITESPACE"
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
		case 8:
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
		"\x03\uAF6F\u8320\u479D\uB75C\u4880\u1605\u191C\uAB37\x02\fU\b\x01\x04"+
		"\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04"+
		"\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x03\x02\x03"+
		"\x02\x03\x02\x03\x03\x03\x03\x05\x03\x1F\n\x03\x03\x04\x03\x04\x03\x04"+
		"\x03\x04\x07\x04%\n\x04\f\x04\x0E\x04(\v\x04\x03\x04\x03\x04\x03\x05\x03"+
		"\x05\x03\x05\x03\x05\x07\x050\n\x05\f\x05\x0E\x053\v\x05\x03\x05\x03\x05"+
		"\x03\x05\x03\x05\x03\x05\x03\x06\x03\x06\x03\x06\x03\x06\x05\x06>\n\x06"+
		"\x03\x07\x03\x07\x03\b\x03\b\x03\b\x03\t\x03\t\x03\n\x03\n\x06\nI\n\n"+
		"\r\n\x0E\nJ\x03\n\x03\n\x03\v\x03\v\x03\v\x03\f\x03\f\x03\f\x03\f\x03"+
		"1\x02\x02\r\x03\x02\x03\x05\x02\x04\x07\x02\x05\t\x02\x06\v\x02\x07\r"+
		"\x02\b\x0F\x02\t\x11\x02\n\x13\x02\v\x15\x02\x02\x17\x02\f\x03\x02\x06"+
		"\x05\x02\f\f\x0F\x0F\u202A\u202B\t\x02\v\f\"\"$$*+00<=^^\x04\x02$$^^\x04"+
		"\x02\v\v\"\"Z\x02\x03\x03\x02\x02\x02\x02\x05\x03\x02\x02\x02\x02\x07"+
		"\x03\x02\x02\x02\x02\t\x03\x02\x02\x02\x02\v\x03\x02\x02\x02\x02\r\x03"+
		"\x02\x02\x02\x02\x0F\x03\x02\x02\x02\x02\x11\x03\x02\x02\x02\x02\x13\x03"+
		"\x02\x02\x02\x02\x17\x03\x02\x02\x02\x03\x19\x03\x02\x02\x02\x05\x1E\x03"+
		"\x02\x02\x02\x07 \x03\x02\x02\x02\t+\x03\x02\x02\x02\v=\x03\x02\x02\x02"+
		"\r?\x03\x02\x02\x02\x0FA\x03\x02\x02\x02\x11D\x03\x02\x02\x02\x13H\x03"+
		"\x02\x02\x02\x15N\x03\x02\x02\x02\x17Q\x03\x02\x02\x02\x19\x1A\x07*\x02"+
		"\x02\x1A\x1B\x07+\x02\x02\x1B\x04\x03\x02\x02\x02\x1C\x1F\x05\x07\x04"+
		"\x02\x1D\x1F\x05\t\x05\x02\x1E\x1C\x03\x02\x02\x02\x1E\x1D\x03\x02\x02"+
		"\x02\x1F\x06\x03\x02\x02\x02 !\x071\x02\x02!\"\x071\x02\x02\"&\x03\x02"+
		"\x02\x02#%\n\x02\x02\x02$#\x03\x02\x02\x02%(\x03\x02\x02\x02&$\x03\x02"+
		"\x02\x02&\'\x03\x02\x02\x02\')\x03\x02\x02\x02(&\x03\x02\x02\x02)*\b\x04"+
		"\x02\x02*\b\x03\x02\x02\x02+,\x071\x02\x02,-\x07,\x02\x02-1\x03\x02\x02"+
		"\x02.0\v\x02\x02\x02/.\x03\x02\x02\x0203\x03\x02\x02\x0212\x03\x02\x02"+
		"\x021/\x03\x02\x02\x0224\x03\x02\x02\x0231\x03\x02\x02\x0245\x07,\x02"+
		"\x0256\x071\x02\x0267\x03\x02\x02\x0278\b\x05\x02\x028\n\x03\x02\x02\x02"+
		"9>\x07=\x02\x02:;\x07=\x02\x02;>\x07\f\x02\x02<>\x05\x11\t\x02=9\x03\x02"+
		"\x02\x02=:\x03\x02\x02\x02=<\x03\x02\x02\x02>\f\x03\x02\x02\x02?@\x07"+
		"0\x02\x02@\x0E\x03\x02\x02\x02AB\x07f\x02\x02BC\x07d\x02\x02C\x10\x03"+
		"\x02\x02\x02DE\x07\f\x02\x02E\x12\x03\x02\x02\x02FI\n\x03\x02\x02GI\x05"+
		"\x15\v\x02HF\x03\x02\x02\x02HG\x03\x02\x02\x02IJ\x03\x02\x02\x02JH\x03"+
		"\x02\x02\x02JK\x03\x02\x02\x02KL\x03\x02\x02\x02LM\x06\n\x02\x02M\x14"+
		"\x03\x02\x02\x02NO\x07^\x02\x02OP\t\x04\x02\x02P\x16\x03\x02\x02\x02Q"+
		"R\t\x05\x02\x02RS\x03\x02\x02\x02ST\b\f\x03\x02T\x18\x03\x02\x02\x02\t"+
		"\x02\x1E&1=HJ\x04\x02\x03\x02\b\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!mongoLexer.__ATN) {
			mongoLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(mongoLexer._serializedATN));
		}

		return mongoLexer.__ATN;
	}

}

