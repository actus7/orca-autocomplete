// Language servers spell the same file differently: `file:///E:/a/b.ts`, `file:///e%3A/a/b.ts`,
// `file:///E%3a/a/B.ts`. A file is the same file whichever way it is written, so compare by a key.

/** A spelling-independent key for a `file:` URI. Paths on a Windows drive ignore case, as the drive does. */
export function uriKey(uri: string): string {
  let path = uri.replace(/^file:\/\//i, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    // Why keep going: a malformed escape still compares equal to the same malformed text.
  }
  path = path.split('\\').join('/')
  return /^\/[a-z]:/i.test(path) ? path.toLowerCase() : path
}

export const sameUri = (a: string, b: string): boolean => uriKey(a) === uriKey(b)
