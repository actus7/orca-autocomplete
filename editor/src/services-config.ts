// Pure decisions for the language services; no Monaco here so Node can test them.

/**
 * Whether code looks like it contains JSX, which a `.ts` file cannot but a `.tsx` file can. Only a
 * closing tag (`</div>`, `</>`) or a self-closing one (`<A />`) counts: a bare `<T>` is also a generic
 * (`<T>(x: T) => x`) or a type assertion (`<Foo>value`), both valid in `.ts` and errors in `.tsx`.
 */
export function looksLikeJsx(content: string): boolean {
  return /<\/[\w.]*\s*>|\/>/.test(content.slice(0, 20_000))
}

/** The name the language service sees for the open file; its extension picks the grammar of the service. */
export function serviceModelName(language: string, jsx: boolean): string {
  if (language === 'typescript') {
    return jsx ? 'file:///untitled.tsx' : 'file:///untitled.ts'
  }
  return jsx ? 'file:///untitled.jsx' : 'file:///untitled.js'
}
