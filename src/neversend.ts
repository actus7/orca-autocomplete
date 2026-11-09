// Code that looks like it holds a secret is never sent to a provider. The check is for patterns that
// are rarely anything else, so ordinary code is not held back. When it finds one the plugin simply
// makes no suggestion there. The caller looks at a margin beyond what it sends, because a secret that
// begins outside the text and reaches into it (a token cut in half, a key whose first line is above)
// would otherwise go out in part.

type Rule = { kind: string; pattern: RegExp }

// Values that are obviously stand-ins, not real secrets.
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|your[_-].*|example.*|changeme|placeholder.*|secret|password|token)$/i

const RULES: readonly Rule[] = [
  // Either end of the block: a window can hold the middle and one marker, or only the body.
  { kind: 'private key', pattern: /-----(?:BEGIN|END) (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  // The body of a key or certificate: several full lines of base64, as PEM and MIME wrap them. The lines
  // may be indented (a YAML `key: |` block) or quoted with a comma after them (a JSON or JS array of lines).
  { kind: 'key body', pattern: /(?:^[ \t]*["']?[A-Za-z0-9+/]{60,80}={0,2}["']?[ \t]*,?[ \t]*\r?\n){3}/m },
  // The same body folded into one string, its line breaks written as the two characters `\n`.
  { kind: 'key body', pattern: /(?:[A-Za-z0-9+/]{60,80}={0,2}\\n){3}/ },
  { kind: 'AWS access key', pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/ },
  { kind: 'AWS secret key', pattern: /aws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}\b/i },
  { kind: 'API key (sk-)', pattern: /\bsk-(?:ant-|proj-|live-|or-)?[A-Za-z0-9_-]{20,}/ },
  { kind: 'GitHub token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/ },
  { kind: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'Stripe key', pattern: /\b[sr]k_(?:live|test)_[0-9a-zA-Z]{16,}/ },
  { kind: 'JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { kind: 'password in a URL', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:[^\s@/"']{3,}@/i }
]

// A name that says "secret" assigned a long literal: `apiKey = "…"`, `password: '…'`.
const ASSIGNED_SECRET = /(?:pass(?:word|wd)?|secret|api[_-]?key|access[_-]?key|auth[_-]?token|private[_-]?key|token)["']?\s*[:=]\s*["']([^"'\s]{16,})["']/gi

/**
 * What kind of secret the text around a cursor seems to hold, or null. The text is looked at three
 * ways, because a secret can show in only one: as the file reads, with a line break at the cursor (a
 * secret that ends a line), joined with nothing between (a token the cursor sits inside), and with the
 * file's name in front (so a name that gives it away is seen too).
 */
export function findSecretAround(before: string, after: string, name = ''): string | null {
  return findSecret(`${name}\n${before}\n${after}`) ?? findSecret(`${before}${after}`)
}

/** What kind of secret the text seems to hold, or null. Never returns the secret itself. */
export function findSecret(text: string): string | null {
  for (const { kind, pattern } of RULES) {
    if (pattern.test(text)) {
      return kind
    }
  }
  for (const match of text.matchAll(ASSIGNED_SECRET)) {
    if (!PLACEHOLDER.test(match[1])) {
      return 'secret assigned in code'
    }
  }
  return null
}
