grammar mongo;

mongoCommands: commands EOF;

commands: command ;

command: DB DOT (functionCall | (STRING_LITERAL DOT functionCall)) (COMMAND_DELIMITTER | EOL);

functionCall: STRING_LITERAL '()';

COMMAND_DELIMITTER: ';';
EOL: [\n];
DOT: '.';
DB: 'db';

STRING_LITERAL: ((~["\\ \t:.'db']) | STRING_ESCAPE )+;

fragment
STRING_ESCAPE: '\\' [\\"];

WHITESPACE: [ \r\n\t] -> skip;