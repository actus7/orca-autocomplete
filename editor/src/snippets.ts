// Snippets: short words that expand into the shape of common code (`iferr` in Go, `def` in Python ...).
// Data per language and no model: they appear in the suggestion list with the AI off, after the symbols
// the language server knows. The syntax is Monaco's: `${1:name}` is a stop to fill in, `$0` is where the
// cursor ends.
import type * as Monaco from 'monaco-editor/esm/vs/editor/edcore.main'

export interface Snippet {
  prefix: string
  detail: string
  body: string
}

const ECMASCRIPT: Snippet[] = [
  { prefix: 'fn', detail: 'function', body: 'function ${1:name}(${2:params}) {\n\t$0\n}' },
  { prefix: 'afn', detail: 'async arrow function', body: 'const ${1:name} = async (${2:params}) => {\n\t$0\n}' },
  { prefix: 'if', detail: 'if', body: 'if (${1:condition}) {\n\t$0\n}' },
  { prefix: 'ife', detail: 'if / else', body: 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}' },
  { prefix: 'for', detail: 'for loop', body: 'for (let ${1:i} = 0; ${1:i} < ${2:items}.length; ${1:i}++) {\n\t$0\n}' },
  { prefix: 'forof', detail: 'for…of loop', body: 'for (const ${1:item} of ${2:items}) {\n\t$0\n}' },
  { prefix: 'switch', detail: 'switch', body: 'switch (${1:value}) {\n\tcase ${2:option}:\n\t\t$0\n\t\tbreak\n\tdefault:\n\t\tbreak\n}' },
  { prefix: 'try', detail: 'try / catch', body: 'try {\n\t$1\n} catch (${2:error}) {\n\t$0\n}' },
  { prefix: 'class', detail: 'class', body: 'class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t$0\n\t}\n}' },
  { prefix: 'imp', detail: 'import', body: "import { ${2:name} } from '${1:module}'" },
  { prefix: 'log', detail: 'console.log', body: 'console.log($0)' },
  { prefix: 'desc', detail: 'describe block', body: "describe('${1:subject}', () => {\n\t$0\n})" },
  { prefix: 'it', detail: 'test case', body: "it('${1:does something}', () => {\n\t$0\n})" }
]

const TYPESCRIPT: Snippet[] = [
  ...ECMASCRIPT,
  { prefix: 'iface', detail: 'interface', body: 'interface ${1:Name} {\n\t$0\n}' },
  { prefix: 'type', detail: 'type alias', body: 'type ${1:Name} = $0' },
  { prefix: 'enum', detail: 'enum', body: 'enum ${1:Name} {\n\t$0\n}' }
]

/** Snippets by Monaco language id. */
export const SNIPPETS: Record<string, Snippet[]> = {
  typescript: TYPESCRIPT,
  javascript: ECMASCRIPT,
  python: [
    { prefix: 'def', detail: 'function', body: 'def ${1:name}(${2:params}):\n\t$0' },
    { prefix: 'adef', detail: 'async function', body: 'async def ${1:name}(${2:params}):\n\t$0' },
    { prefix: 'class', detail: 'class', body: 'class ${1:Name}:\n\tdef __init__(self${2:, params}):\n\t\t$0' },
    { prefix: 'main', detail: 'script entry point', body: "if __name__ == '__main__':\n\t$0" },
    { prefix: 'if', detail: 'if', body: 'if ${1:condition}:\n\t$0' },
    { prefix: 'ife', detail: 'if / else', body: 'if ${1:condition}:\n\t$2\nelse:\n\t$0' },
    { prefix: 'for', detail: 'for loop', body: 'for ${1:item} in ${2:items}:\n\t$0' },
    { prefix: 'while', detail: 'while loop', body: 'while ${1:condition}:\n\t$0' },
    { prefix: 'try', detail: 'try / except', body: 'try:\n\t$1\nexcept ${2:Exception} as ${3:error}:\n\t$0' },
    { prefix: 'with', detail: 'with', body: 'with ${1:resource} as ${2:name}:\n\t$0' },
    { prefix: 'lc', detail: 'list comprehension', body: '[${1:x} for ${1:x} in ${2:items}]' },
    { prefix: 'test', detail: 'pytest test', body: 'def test_${1:name}():\n\t$0' }
  ],
  go: [
    { prefix: 'func', detail: 'function', body: 'func ${1:name}(${2:params}) ${3:error} {\n\t$0\n}' },
    { prefix: 'meth', detail: 'method', body: 'func (${1:r} *${2:Type}) ${3:name}(${4:params}) ${5:error} {\n\t$0\n}' },
    { prefix: 'iferr', detail: 'if err != nil', body: 'if err != nil {\n\treturn ${1:err}\n}' },
    { prefix: 'for', detail: 'for loop', body: 'for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t$0\n}' },
    { prefix: 'forr', detail: 'for range', body: 'for ${1:_}, ${2:v} := range ${3:items} {\n\t$0\n}' },
    { prefix: 'struct', detail: 'struct', body: 'type ${1:Name} struct {\n\t$0\n}' },
    { prefix: 'iface', detail: 'interface', body: 'type ${1:Name} interface {\n\t$0\n}' },
    { prefix: 'switch', detail: 'switch', body: 'switch ${1:value} {\ncase ${2:option}:\n\t$0\ndefault:\n}' },
    { prefix: 'main', detail: 'main function', body: 'func main() {\n\t$0\n}' },
    { prefix: 'test', detail: 'test', body: 'func Test${1:Name}(t *testing.T) {\n\t$0\n}' }
  ],
  rust: [
    { prefix: 'fn', detail: 'function', body: 'fn ${1:name}(${2:params}) -> ${3:()} {\n\t$0\n}' },
    { prefix: 'struct', detail: 'struct', body: 'struct ${1:Name} {\n\t$0\n}' },
    { prefix: 'enum', detail: 'enum', body: 'enum ${1:Name} {\n\t$0\n}' },
    { prefix: 'impl', detail: 'impl block', body: 'impl ${1:Type} {\n\t$0\n}' },
    { prefix: 'match', detail: 'match', body: 'match ${1:value} {\n\t${2:_} => $0,\n}' },
    { prefix: 'iflet', detail: 'if let', body: 'if let ${1:Some(value)} = ${2:option} {\n\t$0\n}' },
    { prefix: 'for', detail: 'for loop', body: 'for ${1:item} in ${2:items} {\n\t$0\n}' },
    { prefix: 'main', detail: 'main function', body: 'fn main() {\n\t$0\n}' },
    { prefix: 'test', detail: 'test', body: '#[test]\nfn ${1:name}() {\n\t$0\n}' }
  ],
  java: [
    { prefix: 'main', detail: 'main method', body: 'public static void main(String[] args) {\n\t$0\n}' },
    { prefix: 'class', detail: 'class', body: 'public class ${1:Name} {\n\t$0\n}' },
    { prefix: 'sout', detail: 'System.out.println', body: 'System.out.println($0);' },
    { prefix: 'for', detail: 'for loop', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}' },
    { prefix: 'foreach', detail: 'for each', body: 'for (${1:var} ${2:item} : ${3:items}) {\n\t$0\n}' },
    { prefix: 'try', detail: 'try / catch', body: 'try {\n\t$1\n} catch (${2:Exception} ${3:e}) {\n\t$0\n}' },
    { prefix: 'if', detail: 'if', body: 'if (${1:condition}) {\n\t$0\n}' },
    { prefix: 'test', detail: 'JUnit test', body: '@Test\nvoid ${1:name}() {\n\t$0\n}' }
  ],
  csharp: [
    { prefix: 'class', detail: 'class', body: 'public class ${1:Name}\n{\n\t$0\n}' },
    { prefix: 'prop', detail: 'auto property', body: 'public ${1:string} ${2:Name} { get; set; }' },
    { prefix: 'cw', detail: 'Console.WriteLine', body: 'Console.WriteLine($0);' },
    { prefix: 'for', detail: 'for loop', body: 'for (var ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++)\n{\n\t$0\n}' },
    { prefix: 'foreach', detail: 'foreach', body: 'foreach (var ${1:item} in ${2:items})\n{\n\t$0\n}' },
    { prefix: 'try', detail: 'try / catch', body: 'try\n{\n\t$1\n}\ncatch (${2:Exception} ${3:e})\n{\n\t$0\n}' },
    { prefix: 'if', detail: 'if', body: 'if (${1:condition})\n{\n\t$0\n}' }
  ],
  cpp: [
    { prefix: 'main', detail: 'main function', body: 'int main(int argc, char** argv) {\n\t$0\n\treturn 0;\n}' },
    { prefix: 'for', detail: 'for loop', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n\t$0\n}' },
    { prefix: 'class', detail: 'class', body: 'class ${1:Name} {\npublic:\n\t$0\n};' },
    { prefix: 'inc', detail: '#include', body: '#include <${1:header}>' }
  ],
  php: [
    { prefix: 'func', detail: 'function', body: 'function ${1:name}(${2:params}) {\n\t$0\n}' },
    { prefix: 'class', detail: 'class', body: 'class ${1:Name}\n{\n\t$0\n}' },
    { prefix: 'if', detail: 'if', body: 'if (${1:condition}) {\n\t$0\n}' },
    { prefix: 'foreach', detail: 'foreach', body: 'foreach (${1:\\$items} as ${2:\\$item}) {\n\t$0\n}' }
  ],
  ruby: [
    { prefix: 'def', detail: 'method', body: 'def ${1:name}(${2:params})\n\t$0\nend' },
    { prefix: 'class', detail: 'class', body: 'class ${1:Name}\n\t$0\nend' },
    { prefix: 'if', detail: 'if', body: 'if ${1:condition}\n\t$0\nend' },
    { prefix: 'each', detail: 'each block', body: '${1:items}.each do |${2:item}|\n\t$0\nend' }
  ],
  shell: [
    { prefix: 'if', detail: 'if', body: 'if [ ${1:condition} ]; then\n\t$0\nfi' },
    { prefix: 'for', detail: 'for loop', body: 'for ${1:item} in ${2:items}; do\n\t$0\ndone' },
    { prefix: 'func', detail: 'function', body: '${1:name}() {\n\t$0\n}' },
    { prefix: 'case', detail: 'case', body: 'case ${1:value} in\n\t${2:pattern})\n\t\t$0\n\t\t;;\nesac' }
  ],
  sql: [
    { prefix: 'sel', detail: 'select', body: 'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};' },
    { prefix: 'ins', detail: 'insert', body: 'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});' },
    { prefix: 'upd', detail: 'update', body: 'UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};' },
    { prefix: 'join', detail: 'join', body: 'JOIN ${1:table} ON ${1:table}.${2:id} = ${3:other}.${4:id}' }
  ]
}

/**
 * The first problem in a snippet body, or null. A stop must be closed, `$0` may appear once, and a bare
 * `$` would be read as a variable by Monaco.
 */
export function snippetProblem(body: string): string | null {
  const opened = (body.match(/(?<!\\)\$\{/g) ?? []).length
  if (opened !== (body.match(/(?<!\\)\$\{\d+(:(\\.|[^}\\])*)?\}/g) ?? []).length) {
    return 'an unclosed stop'
  }
  const stops = /\\.|\$\{(\d+)(?::((?:\\.|[^}\\])*))?\}|\$(\d+)|\$/g
  let zero = 0
  for (const match of body.matchAll(stops)) {
    if (match[0].startsWith('\\')) {
      continue
    }
    if (match[0] === '$') {
      return 'a bare $'
    }
    // Why: inside a default value `$name` is read as a variable and the `$` is lost; it has to be written `\$`.
    if (match[2]?.replace(/\\./g, '').includes('$')) {
      return 'an unescaped $ in a default value'
    }
    zero += (match[1] ?? match[3]) === '0' ? 1 : 0
  }
  return zero > 1 ? 'more than one $0' : null
}

/** Registers the snippets of every language that has some. */
export function registerSnippets(monaco: typeof Monaco): Monaco.IDisposable[] {
  return Object.entries(SNIPPETS).map(([language, snippets]) =>
    monaco.languages.registerCompletionItemProvider(language, {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position)
        const before = word.startColumn > 1 ? model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: word.startColumn - 1, endLineNumber: position.lineNumber, endColumn: word.startColumn }) : ''
        // After a dot the person is reaching for a member, never for a snippet.
        if (before === '.') {
          return { suggestions: [] }
        }
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
        return {
          suggestions: snippets.map((snippet) => ({
            label: { label: snippet.prefix, description: snippet.detail },
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: snippet.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            // Why: after the symbols the language server knows, which are what the person usually wants.
            sortText: `zzz${snippet.prefix}`,
            range
          }))
        }
      }
    })
  )
}
