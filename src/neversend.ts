// Code that looks like it holds a secret is never sent to a provider. The check looks at exactly the
// text that would be sent, and only for patterns that are rarely anything else, so ordinary code is
// not held back. When it finds one the plugin simply makes no suggestion there.

type Rule = { kind: string; pattern: RegExp }

// Values that are obviously stand-ins, not real secrets.
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|your[_-].*|example.*|changeme|placeholder.*|secret|password|token)$/i

const RULES: readonly Rule[] = [
  { kind: 'private key', pattern: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
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
