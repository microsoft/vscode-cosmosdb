grammar mongo;

@lexer::members {
	private isExternalIdentifierText(text) {
		return text === 'db';
	}
}

mongoCommands: commands EOF;

commands: (command | emptyCommand)+;

command: DB DOT (functionCall | (STRING_LITERAL DOT functionCall)) COMMAND_DELIMITTER;
emptyCommand: COMMAND_DELIMITTER;

functionCall: STRING_LITERAL '()';

COMMAND_DELIMITTER: ';' | ';\n' | EOL;
DOT: '.';
DB: 'db';
EOL: '\n';

STRING_LITERAL: ((~["\\ \t\n:.;()]) | STRING_ESCAPE )+ {!this.isExternalIdentifierText(this.text)}?;

fragment
STRING_ESCAPE: '\\' [\\"];

WHITESPACE: [ \t] -> skip;
