// Postfix completion: write an expression, type a dot and a keyword, and the expression is wrapped by a
// template (`ready.if` becomes `if (ready) { ... }`). It needs no model and no language server: the rule
// reads the text before the cursor, so it works the same with the AI off and in every file of a language
// listed here.
import type * as Monaco from 'monaco-editor/esm/vs/editor/edcore.main'

export interface PostfixTemplate {
  key: string
  detail: string
  /** The snippet; `<expr>` stands for the expression before the dot. */
  body: string
  /** Leave the parentheses of `(a && b).not` in place; every other template wants the bare expression. */
  keepParens?: boolean
}

const EXPR = '<expr>'

const ECMASCRIPT: PostfixTemplate[] = [
  { key: 'if', detail: 'if (expr) { … }', body: `if (${EXPR}) {\n\t$0\n}` },
  { key: 'else', detail: 'if (!expr) { … }', body: `if (!${EXPR}) {\n\t$0\n}`, keepParens: true },
  { key: 'null', detail: 'if (expr == null) { … }', body: `if (${EXPR} == null) {\n\t$0\n}` },
  { key: 'not', detail: '!expr', body: `!${EXPR}`, keepParens: true },
  { key: 'var', detail: 'const name = expr', body: `const \${1:name} = ${EXPR}` },
  { key: 'return', detail: 'return expr', body: `return ${EXPR}` },
  { key: 'log', detail: 'console.log(expr)', body: `console.log(${EXPR})` },
  { key: 'for', detail: 'for (const item of expr) { … }', body: `for (const \${1:item} of ${EXPR}) {\n\t$0\n}` },
  { key: 'await', detail: 'await expr', body: `await ${EXPR}`, keepParens: true }
]

/** Postfix templates by Monaco language id. */
export const POSTFIX: Record<string, PostfixTemplate[]> = {
  typescript: ECMASCRIPT,
  javascript: ECMASCRIPT,
  python: [
    { key: 'if', detail: 'if expr:', body: `if ${EXPR}:\n\t$0` },
    { key: 'else', detail: 'if not expr:', body: `if not ${EXPR}:\n\t$0`, keepParens: true },
    { key: 'none', detail: 'if expr is None:', body: `if ${EXPR} is None:\n\t$0` },
    { key: 'not', detail: 'not expr', body: `not ${EXPR}`, keepParens: true },
    { key: 'var', detail: 'name = expr', body: `\${1:name} = ${EXPR}` },
    { key: 'return', detail: 'return expr', body: `return ${EXPR}` },
    { key: 'print', detail: 'print(expr)', body: `print(${EXPR})` },
    { key: 'len', detail: 'len(expr)', body: `len(${EXPR})` },
    { key: 'for', detail: 'for item in expr:', body: `for \${1:item} in ${EXPR}:\n\t$0` }
  ],
  go: [
    { key: 'if', detail: 'if expr { … }', body: `if ${EXPR} {\n\t$0\n}` },
    { key: 'else', detail: 'if !expr { … }', body: `if !${EXPR} {\n\t$0\n}`, keepParens: true },
    { key: 'nil', detail: 'if expr == nil { … }', body: `if ${EXPR} == nil {\n\t$0\n}` },
    { key: 'not', detail: '!expr', body: `!${EXPR}`, keepParens: true },
    { key: 'var', detail: 'name := expr', body: `\${1:name} := ${EXPR}` },
    { key: 'return', detail: 'return expr', body: `return ${EXPR}` },
    { key: 'print', detail: 'fmt.Println(expr)', body: `fmt.Println(${EXPR})` },
    { key: 'range', detail: 'for _, v := range expr { … }', body: `for \${1:_}, \${2:v} := range ${EXPR} {\n\t$0\n}` }
  ],
  rust: [
    { key: 'if', detail: 'if expr { … }', body: `if ${EXPR} {\n\t$0\n}` },
    { key: 'else', detail: 'if !expr { … }', body: `if !${EXPR} {\n\t$0\n}`, keepParens: true },
    { key: 'not', detail: '!expr', body: `!${EXPR}`, keepParens: true },
    { key: 'let', detail: 'let name = expr;', body: `let \${1:name} = ${EXPR};` },
    { key: 'return', detail: 'return expr;', body: `return ${EXPR};` },
    { key: 'dbg', detail: 'dbg!(expr)', body: `dbg!(${EXPR})` },
    { key: 'for', detail: 'for item in expr { … }', body: `for \${1:item} in ${EXPR} {\n\t$0\n}` },
    { key: 'match', detail: 'match expr { … }', body: `match ${EXPR} {\n\t\${1:_} => $0,\n}` }
  ],
  java: [
    { key: 'if', detail: 'if (expr) { … }', body: `if (${EXPR}) {\n\t$0\n}` },
    { key: 'else', detail: 'if (!expr) { … }', body: `if (!${EXPR}) {\n\t$0\n}`, keepParens: true },
    { key: 'null', detail: 'if (expr == null) { … }', body: `if (${EXPR} == null) {\n\t$0\n}` },
    { key: 'not', detail: '!expr', body: `!${EXPR}`, keepParens: true },
    { key: 'var', detail: 'var name = expr;', body: `var \${1:name} = ${EXPR};` },
    { key: 'return', detail: 'return expr;', body: `return ${EXPR};` },
    { key: 'sout', detail: 'System.out.println(expr);', body: `System.out.println(${EXPR});` },
    { key: 'for', detail: 'for (var item : expr) { … }', body: `for (var \${1:item} : ${EXPR}) {\n\t$0\n}` }
  ],
  csharp: [
    { key: 'if', detail: 'if (expr) { … }', body: `if (${EXPR})\n{\n\t$0\n}` },
    { key: 'else', detail: 'if (!expr) { … }', body: `if (!${EXPR})\n{\n\t$0\n}`, keepParens: true },
    { key: 'null', detail: 'if (expr == null) { … }', body: `if (${EXPR} == null)\n{\n\t$0\n}` },
    { key: 'not', detail: '!expr', body: `!${EXPR}`, keepParens: true },
    { key: 'var', detail: 'var name = expr;', body: `var \${1:name} = ${EXPR};` },
    { key: 'return', detail: 'return expr;', body: `return ${EXPR};` },
    { key: 'cw', detail: 'Console.WriteLine(expr);', body: `Console.WriteLine(${EXPR});` },
    { key: 'foreach', detail: 'foreach (var item in expr) { … }', body: `foreach (var \${1:item} in ${EXPR})\n{\n\t$0\n}` }
  ]
}

export interface PostfixScan {
  /** Column (0-based) in the line where the expression starts. */
  start: number
  expression: string
  /** What was typed after the dot so far. */
  typed: string
}

/** True when `before` ends inside an open string: an odd number of unescaped quotes of one kind. */
function insideString(before: string): boolean {
  for (const quote of ["'", '"', '`']) {
    let count = 0
    for (let index = 0; index < before.length; index += 1) {
      if (before[index] === '\\') {
        index += 1
      } else if (before[index] === quote) {
        count += 1
      }
    }
    if (count % 2 === 1) {
      return true
    }
  }
  return false
}

/**
 * The expression right before the last dot of the line, and what follows the dot: a name, a chain of
 * members, calls and index accesses. A bigger expression has to be wrapped in parentheses first.
 */
export function scanPostfix(linePrefix: string): PostfixScan | null {
  if (/^\s*(\/\/|#|\*|--|\/\*)/.test(linePrefix)) {
    return null
  }
  const dot = linePrefix.lastIndexOf('.')
  if (dot < 1) {
    return null
  }
  const typed = linePrefix.slice(dot + 1)
  if (!/^\w*$/.test(typed)) {
    return null
  }
  let depth = 0
  let index = dot - 1
  for (; index >= 0; index -= 1) {
    const char = linePrefix[index]
    if (char === ')' || char === ']') {
      depth += 1
    } else if (char === '(' || char === '[') {
      if (depth === 0) {
        break
      }
      depth -= 1
    } else if (depth === 0 && !/[\w$.]/.test(char)) {
      break
    }
  }
  const start = index + 1
  const expression = linePrefix.slice(start, dot)
  // A number (`1.`), a spread (`...x`) or a dot inside a string is not an expression to wrap.
  if (!expression || expression.startsWith('.') || /^\d+$/.test(expression) || insideString(linePrefix.slice(0, start))) {
    return null
  }
  return { start, expression, typed }
}

/** `(a && b)` becomes `a && b` when the parentheses wrap the whole thing; anything else is returned as it is. */
export function unwrapParens(expression: string): string {
  if (!expression.startsWith('(') || !expression.endsWith(')')) {
    return expression
  }
  let depth = 0
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === '(') {
      depth += 1
    } else if (expression[index] === ')') {
      depth -= 1
      if (depth === 0 && index < expression.length - 1) {
        return expression
      }
    }
  }
  return expression.slice(1, -1)
}

/** The snippet text for a template around an expression; `$`, `}` and `\` of the expression are escaped for the snippet syntax. */
export function expandPostfix(template: PostfixTemplate, expression: string): string {
  const inner = template.keepParens ? expression : unwrapParens(expression)
  return template.body.split(EXPR).join(inner.replace(/[\\$}]/g, '\\$&'))
}

/** Registers postfix completion for every language that has templates. */
export function registerPostfix(monaco: typeof Monaco): Monaco.IDisposable[] {
  return Object.entries(POSTFIX).map(([language, templates]) =>
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.'],
      provideCompletionItems(model, position) {
        const prefix = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column })
        const found = scanPostfix(prefix)
        if (!found) {
          return { suggestions: [] }
        }
        // Why: the range covers the expression and the dot too, so accepting replaces all of it with the template.
        const range = new monaco.Range(position.lineNumber, found.start + 1, position.lineNumber, position.column)
        return {
          suggestions: templates.map((template) => ({
            label: { label: `.${template.key}`, description: template.detail },
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: expandPostfix(template, found.expression),
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: `${found.expression}.${template.key}`,
            // Why: after the real members of the object, which the language server offers for the same dot.
            sortText: `zz${template.key}`,
            range
          }))
        }
      }
    })
  )
}
