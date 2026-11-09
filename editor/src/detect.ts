// The generic editor never sees a file name, so it guesses the language from the content.
// Each rule is a cheap, specific signature; the first that matches wins. Anything unrecognised stays
// plain text, which still gets suggestions.

const SAMPLE_CHARS = 4000

type Rule = { id: string; test: RegExp }

// Why this order: shebangs and very distinctive keywords first, loose shapes (CSS, YAML) last.
const RULES: readonly Rule[] = [
  { id: 'powershell', test: /^#!.*\bpwsh\b|^\s*param\s*\(|\bGet-[A-Z]\w+|\$\w+\s*=\s*\$|\bWrite-Host\b/m },
  { id: 'perl', test: /^#!.*\bperl\b|^use\s+strict\s*;|^my\s+[$@%]\w+/m },
  { id: 'lua', test: /^#!.*\blua\b|^\s*local\s+\w+\s*=|\bfunction\s+[\w.:]+\s*\([^)]*\)\s*$[\s\S]*\bend\b/m },
  { id: 'elixir', test: /^\s*defmodule\s+[\w.]+\s+do\b|^\s*def\s+\w+.*\bdo\s*$/m },
  { id: 'clojure', test: /^\s*\((ns|defn|def|defmacro)\s/m },
  { id: 'dockerfile', test: /^\s*FROM\s+\S+(\s+AS\s+\w+)?\s*$/im },
  { id: 'protobuf', test: /^\s*syntax\s*=\s*"proto[23]"|^\s*message\s+\w+\s*\{/m },
  { id: 'hcl', test: /^\s*(resource|provider|variable|module|data|terraform)\s+"?[\w-]+"?(\s+"[\w-]+")?\s*\{/m },
  { id: 'graphql', test: /^\s*(type|input|enum|interface|schema|query|mutation|subscription)\s+\w*\s*[({]|^\s*extend\s+type\b/m },
  { id: 'bat', test: /^@?echo\s+off\b|^\s*rem\s|^::|^\s*set\s+\w+=/im },
  { id: 'dart', test: /^\s*import\s+'(dart|package):|\bvoid\s+main\s*\(\s*\)|\bStatelessWidget\b|\bStatefulWidget\b/m },
  { id: 'scala', test: /^\s*(object|case\s+class|trait)\s+\w+|\bdef\s+\w+\s*\(.*\)\s*:\s*\w+\s*=/m },
  { id: 'fsharp', test: /^\s*(let\s+(rec\s+)?\w+.*=|module\s+\w+|open\s+System)\s*$|^\s*let\s+\w+\s+.*=\s*$/m },
  { id: 'julia', test: /^\s*using\s+[A-Z]\w*\s*$|^\s*function\s+\w+\s*\(.*\)\s*$[\s\S]*^\s*end\s*$/m },
  { id: 'r', test: /<-\s|^\s*library\(\w+\)|\bfunction\s*\(.*\)\s*\{[\s\S]*\}/m },
  { id: 'xml', test: /^\s*<\?xml\b|^\s*<[A-Za-z][\w:-]*(\s+[\w:-]+="[^"]*")*\s*>/m },
  { id: 'markdown', test: /^#{1,6}\s+\S|^\s*[-*]\s+\[[ x]\]|^```/m },
  { id: 'less', test: /^\s*@[\w-]+\s*:\s*[^;]+;|^\s*\.[\w-]+\s*\(.*\)\s*;/m },
  { id: 'scss', test: /^\s*[.#@:]?[\w-][\w\s.#>:+~,*&[\]=-]*\{[^}]*:[^}]*;/m },
  { id: 'yaml', test: /^---\s*$|^[\w.-]+:\s*(\S.*)?$[\s\S]*^\s*-\s+\S/m }
]

/** The Monaco language id of the content, or `plaintext` when no rule recognises it. */
export function detectLanguage(text: string): string {
  const sample = text.slice(0, SAMPLE_CHARS)
  if (!sample.trim()) {
    return 'plaintext'
  }
  return RULES.find((rule) => rule.test.test(sample))?.id ?? 'plaintext'
}
