grammar mongo;

@lexer::members {
	private isExternalIdentifierText(text) {
		return text === 'db';
	}
}

mongoCommands: commands EOF;

commands: (command)+;

command: DB DOT (functionCall | (STRING_LITERAL DOT functionCall)) COMMAND_DELIMITTER;

functionCall: STRING_LITERAL '()';

COMMAND_DELIMITTER: ';' | ';\n' | '\n';
DOT: '.';
DB: 'db';

STRING_LITERAL: ((~["\\ \t\n:.;()]) | STRING_ESCAPE )+ {!this.isExternalIdentifierText(this.text)}?;

fragment
STRING_ESCAPE: '\\' [\\"];

WHITESPACE: [ \t] -> skip;