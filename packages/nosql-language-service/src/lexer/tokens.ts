/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Chevrotain token definitions for CosmosDB NoSQL SQL
// Mirrors y_tab.h token codes and SqlScanner keyword recognition.
// ---------------------------------------------------------------------------

import { createToken, Lexer, type TokenType } from 'chevrotain';

// ========================== Whitespace & comments ============================

export const WhiteSpace = createToken({
    name: 'WhiteSpace',
    pattern: /\s+/,
    group: Lexer.SKIPPED,
});

export const LineComment = createToken({
    name: 'LineComment',
    pattern: /--[^\r\n]*/,
    group: Lexer.SKIPPED,
});

export const BlockComment = createToken({
    name: 'BlockComment',
    pattern: /\/\*[\s\S]*?\*\//,
    group: Lexer.SKIPPED,
});

// ========================== Identifiers (declared early for longer_alt) ======

// Identifier MUST be created before keywords so they can reference it
// via longer_alt, but placed AFTER keywords in the token array.
export const Identifier = createToken({
    name: 'Identifier',
    pattern: /[a-zA-Z_][a-zA-Z0-9_]*/,
});

// ========================== Keywords =========================================
// Keywords must appear BEFORE Identifier in the token list.
// All keywords are case-insensitive.
// Shorter keywords that are prefixes of longer ones need longer_alt pointing
// to the longer keyword as well as Identifier.

const kw = (name: string, pattern: RegExp, longerAlts?: TokenType[]): TokenType =>
    createToken({ name, pattern, longer_alt: longerAlts ?? Identifier });

export const Asc = kw('ASC', /ASC/i);
export const As = kw('AS', /AS/i, [Asc, Identifier]);
export const And = kw('AND', /AND/i);
export const Array_ = kw('ARRAY', /ARRAY/i);
export const Between = kw('BETWEEN', /BETWEEN/i);
export const By = kw('BY', /BY/i);
export const Case = kw('CASE', /CASE/i);
export const Cast = kw('CAST', /CAST/i);
export const Convert = kw('CONVERT', /CONVERT/i);
export const Cross = kw('CROSS', /CROSS/i);
export const Desc = kw('DESC', /DESC/i);
export const Distinct = kw('DISTINCT', /DISTINCT/i);
export const Else = kw('ELSE', /ELSE/i);
export const End = kw('END', /END/i);
export const Escape = kw('ESCAPE', /ESCAPE/i);
export const Exists = kw('EXISTS', /EXISTS/i);
export const False_ = kw('FALSE', /false/i);
export const For = kw('FOR', /FOR/i);
export const From = kw('FROM', /FROM/i);
export const Group = kw('GROUP', /GROUP/i);
export const Having = kw('HAVING', /HAVING/i);
export const Inner = kw('INNER', /INNER/i);
export const Insert = kw('INSERT', /INSERT/i);
export const Into = kw('INTO', /INTO/i);
export const In = kw('IN', /IN/i, [Inner, Insert, Into, Identifier]);
export const Is = kw('IS', /IS/i);
export const Join = kw('JOIN', /JOIN/i);
export const Left = kw('LEFT', /LEFT/i);
export const Let = kw('LET', /LET/i);
export const Like = kw('LIKE', /LIKE/i);
export const Limit = kw('LIMIT', /LIMIT/i);
export const Not = kw('NOT', /NOT/i);
export const Null_ = kw('NULL', /null/i);
export const Offset = kw('OFFSET', /OFFSET/i);
export const On = kw('ON', /ON/i);
export const Order = kw('ORDER', /ORDER/i);
export const Or = kw('OR', /OR/i, [Order, Identifier]);
export const Outer = kw('OUTER', /OUTER/i);
export const Over = kw('OVER', /OVER/i);
export const Rank = kw('RANK', /RANK/i);
export const Right = kw('RIGHT', /RIGHT/i);
export const Select = kw('SELECT', /SELECT/i);
export const Set = kw('SET', /SET/i);
export const Then = kw('THEN', /THEN/i);
export const Top = kw('TOP', /TOP/i);
export const True_ = kw('TRUE', /true/i);
export const Undefined_ = kw('UNDEFINED', /undefined/i);
export const Udf = kw('UDF', /udf/i);
export const Update = kw('UPDATE', /UPDATE/i);
export const Value = kw('VALUE', /VALUE/i);
export const When = kw('WHEN', /WHEN/i);
export const Where = kw('WHERE', /WHERE/i);
export const With = kw('WITH', /WITH/i);

// ========================== Identifiers & literals ===========================

export const Parameter = createToken({
    name: 'Parameter',
    pattern: /@[a-zA-Z_][a-zA-Z0-9_]*/,
});

export const StringLiteral = createToken({
    name: 'StringLiteral',
    pattern: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/,
});

// Number: integer and double (separate tokens via category)
// NumberLiteral is a category parent — existing code consuming
// NumberLiteral matches both subtypes.  OFFSET/LIMIT restrict
// to IntegerLiteral only, matching C++ sql.y.
export const NumberLiteral = createToken({
    name: 'NumberLiteral',
    pattern: Lexer.NA, // category token — never matched directly
});

// DoubleLiteral must be listed BEFORE IntegerLiteral in allTokens
// so "3.14" is not split into integer "3" + error ".14".
export const DoubleLiteral = createToken({
    name: 'DoubleLiteral',
    pattern: /(?:0|[1-9]\d*)\.\d+(?:[eE][+-]?\d+)?|(?:0|[1-9]\d*)[eE][+-]?\d+/,
    categories: [NumberLiteral],
});

export const IntegerLiteral = createToken({
    name: 'IntegerLiteral',
    pattern: /0|[1-9]\d*/,
    categories: [NumberLiteral],
});

// ========================== Multi-char operators ==============================

export const NotEqual = createToken({ name: 'NotEqual', pattern: /!=|<>/ });
export const LessThanEqual = createToken({ name: 'LessThanEqual', pattern: /<=/ });
export const GreaterThanEqual = createToken({ name: 'GreaterThanEqual', pattern: />=/ });
export const LeftShift = createToken({ name: 'LeftShift', pattern: /<</ });
export const RightShiftZF = createToken({ name: 'RightShiftZF', pattern: />>>/ });
export const RightShift = createToken({ name: 'RightShift', pattern: />>/ });
export const StringConcat = createToken({ name: 'StringConcat', pattern: /\|\|/ });
export const Coalesce = createToken({ name: 'Coalesce', pattern: /\?\?/ });

// ========================== Single-char tokens ===============================

export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const LBracket = createToken({ name: 'LBracket', pattern: /\[/ });
export const RBracket = createToken({ name: 'RBracket', pattern: /]/ });
export const LBrace = createToken({ name: 'LBrace', pattern: /\{/ });
export const RBrace = createToken({ name: 'RBrace', pattern: /}/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Semicolon = createToken({ name: 'Semicolon', pattern: /;/ });
export const Star = createToken({ name: 'Star', pattern: /\*/ });
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Minus = createToken({ name: 'Minus', pattern: /-/ });
export const Slash = createToken({ name: 'Slash', pattern: /\// });
export const Percent = createToken({ name: 'Percent', pattern: /%/ });
export const Ampersand = createToken({ name: 'Ampersand', pattern: /&/ });
export const Pipe = createToken({ name: 'Pipe', pattern: /\|/ });
export const Caret = createToken({ name: 'Caret', pattern: /\^/ });
export const Tilde = createToken({ name: 'Tilde', pattern: /~/ });
export const Equals = createToken({ name: 'Equals', pattern: /=/ });
export const LessThan = createToken({ name: 'LessThan', pattern: /</ });
export const GreaterThan = createToken({ name: 'GreaterThan', pattern: />/ });
export const Bang = createToken({ name: 'Bang', pattern: /!/ });
export const Question = createToken({ name: 'Question', pattern: /\?/ });

// ========================== Token list (ORDER MATTERS) =======================
// Chevrotain tries tokens in order. Longer patterns and keywords go first.

export const allTokens: TokenType[] = [
    // Whitespace & comments (skipped)
    WhiteSpace,
    LineComment,
    BlockComment,

    // Literals (before operators so "3.14" isn't split)
    StringLiteral,
    DoubleLiteral, // must be before IntegerLiteral
    IntegerLiteral,
    NumberLiteral, // category parent — must follow concrete subtypes
    Parameter,

    // Multi-char operators (before single-char to avoid partial match)
    RightShiftZF, // >>> before >>
    RightShift, // >> before >
    LeftShift, // << before <
    NotEqual, // != before !  and  <> before <
    LessThanEqual, // <= before <
    GreaterThanEqual, // >= before >
    StringConcat, // || before |
    Coalesce, // ?? before ?

    // Keywords (before Identifier — longer keywords before shorter prefixes)
    And,
    Array_,
    Asc,
    As,
    Between,
    By,
    Case,
    Cast,
    Convert,
    Cross,
    Desc,
    Distinct,
    Else,
    End,
    Escape,
    Exists,
    False_,
    For,
    From,
    Group,
    Having,
    Inner,
    Insert,
    Into,
    In,
    Is,
    Join,
    Left,
    Let,
    Like,
    Limit,
    Not,
    Null_,
    Offset,
    On,
    Order,
    Or,
    Outer,
    Over,
    Rank,
    Right,
    Select,
    Set,
    Then,
    Top,
    True_,
    Undefined_,
    Udf,
    Update,
    Value,
    When,
    Where,
    With,

    // Identifier (catch-all for names)
    Identifier,

    // Single-char operators & punctuation
    LParen,
    RParen,
    LBracket,
    RBracket,
    LBrace,
    RBrace,
    Dot,
    Comma,
    Colon,
    Semicolon,
    Star,
    Plus,
    Minus,
    Slash,
    Percent,
    Ampersand,
    Pipe,
    Caret,
    Tilde,
    Equals,
    LessThan,
    GreaterThan,
    Bang,
    Question,
];

// ========================== Derived keyword list ==============================

/**
 * SQL keyword names (uppercase) derived from the token definitions.
 *
 * A token is considered a keyword if it was created via `kw()` — i.e.
 * it has `Identifier` in its `LONGER_ALT` list.  This avoids manually
 * duplicating the keyword list in each editor adapter.
 */
export const SQL_KEYWORDS: readonly string[] = allTokens
    .filter((t) => {
        const alt = t.LONGER_ALT;
        if (!alt) return false;
        const alts = Array.isArray(alt) ? alt : [alt];
        return alts.includes(Identifier);
    })
    .map((t) => t.name);

