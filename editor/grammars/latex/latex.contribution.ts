// Monaco has no LaTeX grammar — it is not one of its `basic-languages` — so the plugin brings its own.
// It registers on import, the way Monaco's contributions do, and the generic editor loads it once
// `detectLanguage` recognises a file as LaTeX.
//
// The token names are Monaco's own (`comment`, `keyword`, `number`, `type`, `delimiter`), so the
// stock dark and light themes colour it without rules of their own.

import { languages } from 'monaco-editor/esm/vs/editor/edcore.main'

export const id = 'latex'

/** A length such as `1.5em` or `2pt`: a value, not prose. */
const DIMENSION = /\d+(?:\.\d+)?(?:em|ex|pt|pc|bp|dd|cc|nd|nc|sp|mm|cm|in|mu|px|fil|fill)\b/

// Why a list: the names that build the document read as structure, every other `\foo` as a macro.
// Colouring them all the same way would make `\section` and `\cite` look alike.
const STRUCTURE = String.raw`\\(?:begin|end|documentclass|usepackage|RequirePackage|section|subsection|subsubsection|paragraph|chapter|part|title|author|date|maketitle|label|ref|eqref|pageref|cite|citep|citet|bibliography|bibliographystyle|include|input|newcommand|renewcommand|providecommand|def|let|item|caption|footnote|includegraphics)\b`

/** The text inside `$…$`, `$$…$$` and `\[…\]`: commands, braces, operators and numbers. */
const MATH: languages.IMonarchLanguageRule[] = [
  [/%/, 'comment', '@comment'],
  [/\\[a-zA-Z@]+\*?/, 'type'],
  [/[{}]/, 'delimiter.bracket'],
  [/[=+\-*/<>]/, 'operator'],
  [/[&~^_]/, 'operator'],
  [/\d+(?:\.\d+)?/, 'number'],
  [/./, '']
]

const TOKENIZER: languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.latex',
  ignoreCase: false,

  tokenizer: {
    root: [
      [/%/, 'comment', '@comment'],
      // Verbatim first: inside it, a backslash is a backslash.
      [/\\begin\s*\{\s*(?:verbatim|lstlisting)\s*\}/, { token: 'keyword', next: '@verbatim' }],
      [/\$\$/, { token: 'delimiter', next: '@displayDollar' }],
      [/\\\[/, { token: 'delimiter', next: '@displayBracket' }],
      [/\$/, { token: 'delimiter', next: '@math' }],
      [/\\(?:begin|end)\s*\{/, 'keyword'],
      // The brace that closes `\begin{document}` and every other group.
      [/[{}]/, 'delimiter.bracket'],
      [/[[\]]/, 'delimiter.square'],
      [new RegExp(STRUCTURE), 'keyword'],
      // A backslash name that is not structure, then `\\`, `\%`, `\$` and the like.
      [/\\[a-zA-Z@]+\*?/, 'type'],
      [/\\[^a-zA-Z@]/, 'type'],
      [DIMENSION, 'number'],
      [/\d+/, 'number'],
      [/[&~^_#]/, 'operator'],
      [/[(),;:]/, 'delimiter']
    ],

    comment: [
      [/[^%]+$/, 'comment', '@pop'],
      [/./, 'comment']
    ],

    // `\begin{verbatim}` … `\end{verbatim}`, where nothing else is read as a command.
    verbatim: [
      [/\\end\s*\{\s*(?:verbatim|lstlisting)\s*\}/, { token: 'keyword', next: '@pop' }],
      [/./, '']
    ],

    math: [[/\$/, { token: 'delimiter', next: '@pop' }], ...MATH],
    displayDollar: [[/\$\$/, { token: 'delimiter', next: '@pop' }], ...MATH],
    displayBracket: [[/\\\]/, { token: 'delimiter', next: '@pop' }], ...MATH]
  }
}

/** What a LaTeX file needs beyond tokens: its comment, its brackets and the words read as one. */
const CONFIGURATION: languages.LanguageConfiguration = {
  comments: { lineComment: '%' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')']
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '$', close: '$' },
    { open: '`', close: "'" }
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '$', close: '$' }
  ]
}

languages.register({
  id,
  extensions: ['.tex', '.sty', '.cls'],
  aliases: ['LaTeX', 'TeX']
})
languages.setLanguageConfiguration(id, CONFIGURATION)
languages.setMonarchTokensProvider(id, TOKENIZER)
