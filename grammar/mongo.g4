grammar mongo;

@lexer::members {
	private isExternalIdentifierText(text) {
		return text === 'db';
	}
}

mongoCommands
	: commands EOF
	;

commands: (command | emptyCommand | comment )+;

command: DB DOT (functionCall | (collection DOT functionCall)) SEMICOLON?;

emptyCommand
	: SEMICOLON
	;

collection
	: STRING_LITERAL;

functionCall
	: FUNCTION_NAME = STRING_LITERAL arguments
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
	: literal
	| objectLiteral
	| arrayLiteral
	| functionCall
	;

literal
	: (NullLiteral
	| BooleanLiteral
	| StringLiteral
	)
	| NumericLiteral
	;

propertyName
	: StringLiteral
	;

comment
	: SingleLineComment
	| MultiLineComment
	;

SingleLineComment
	: '//' ~[\r\n\u2028\u2029]* -> channel(HIDDEN)
 	;

MultiLineComment
	: '/*' .*? '*/' -> channel(HIDDEN)
	;

StringLiteral
	: SINGLE_QUOTED_STRING_LITERAL
	| DOUBLE_QUOTED_STRING_LITERAL
	;

NullLiteral
	: 'null'
	;

BooleanLiteral
	: 'true'
	| 'false'
	;

NumericLiteral
	: '-'?DecimalLiteral
	;

DecimalLiteral
	: DecimalIntegerLiteral '.' DecimalDigit* ExponentPart?
	| '.' DecimalDigit+ ExponentPart?
	| DecimalIntegerLiteral ExponentPart?
	;

LineTerminator
	: [\r\n\u2028\u2029] -> channel(HIDDEN)
	;

SEMICOLON: ';';
DOT: '.';
DB: 'db';
LF: '\n';
CRLF: '\r\n';

STRING_LITERAL: ((~[",\\ \t\n:.;(){}\-]) | STRING_ESCAPE )+ {!this.isExternalIdentifierText(this.text)}?;
DOUBLE_QUOTED_STRING_LITERAL: '"' ((~["\\]) | STRING_ESCAPE)* '"';
SINGLE_QUOTED_STRING_LITERAL: '\'' ((~['\\]) | STRING_ESCAPE)* '\'';

fragment
STRING_ESCAPE: '\\' [\\"\\'];

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