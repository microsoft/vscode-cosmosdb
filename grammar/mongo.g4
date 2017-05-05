grammar mongo;

@lexer::members {
	private isExternalIdentifierText(text) {
		return text === 'db';
	}
}

mongoCommands
	: commands EOF
	;

commands: (command | emptyCommand | Comment )+;

command: DB DOT (functionCall | (STRING_LITERAL DOT functionCall)) SEMICOLON?;

emptyCommand
	: SEMICOLON
	;

functionCall
	: STRING_LITERAL arguments
	;

arguments
	: OPEN_PARENTHESIS = '(' argumentList? CLOSED_PARENTHESIS = ')'
	;

argumentList
	: literal
	| objectLiteral
	| arrayLiteral
	;

objectLiteral
	: '{' propertyNameAndValueList? ','? '}'
	;

arrayLiteral
	: '[' elementList? ']'
	;

elementList
	: propertyValue ( ',' propertyValue )*
	;

propertyNameAndValueList
	: propertyAssignment ( ',' propertyAssignment )*
	;

propertyAssignment
	: propertyName ':' propertyValue
	;

propertyValue
	: functionCall
	| objectLiteral
	| arrayLiteral
	| literal
	;

literal
	: (NullLiteral
	| BooleanLiteral
	| QUOTED_STRING_LITERAL
	)
	| numericLiteral
	;

propertyName
	: QUOTED_STRING_LITERAL
	;

Comment
	: SingleLineComment
	| MultiLineComment
	;

SingleLineComment
	: '//' ~[\r\n\u2028\u2029]* -> channel(HIDDEN)
 	;

MultiLineComment
	: '/*' .*? '*/' -> channel(HIDDEN)
	;

NullLiteral
	: 'null'
	;

BooleanLiteral
	: 'true'
	| 'false'
	;

numericLiteral
	: DecimalLiteral
	;

DecimalLiteral
	: DecimalIntegerLiteral '.' DecimalDigit* ExponentPart?
	| '.' DecimalDigit+ ExponentPart?
	| DecimalIntegerLiteral ExponentPart?
	;

LineTerminator
	: [\r\n\u2028\u2029] -> channel(HIDDEN)
	;

// COMMAND_DELIMITTER: ';' | ';\n' | LF | CRLF;
SEMICOLON: ';';
DOT: '.';
DB: 'db';
LF: '\n';
CRLF: '\r\n';

STRING_LITERAL: ((~["\\ \t\n:.;()]) | STRING_ESCAPE )+ {!this.isExternalIdentifierText(this.text)}?;
QUOTED_STRING_LITERAL: '"' ((~["\\]) | STRING_ESCAPE)* '"';

fragment
STRING_ESCAPE: '\\' [\\"];

fragment DecimalIntegerLiteral
	: '0'
	| [1-9] DecimalDigit*
	;

fragment ExponentPart
	: [eE] [+-]? DecimalDigit+
	;

fragment DecimalDigit
	: [0-9]
	;

WHITESPACE: [ \t] -> skip;