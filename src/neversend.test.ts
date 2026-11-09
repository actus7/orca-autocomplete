import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findSecret, findSecretAround } from './neversend.ts'

// Built from pieces so this file does not itself look like it holds secrets.
const A = (n: number, c = 'A'): string => c.repeat(n)

const SECRETS: [string, string][] = [
  ['private key', `-----BEGIN ${'RSA '}PRIVATE KEY-----\nMIIE`],
  ['private key', `-----BEGIN ${'OPENSSH '}PRIVATE KEY-----`],
  ['private key', '-----END RSA PRIVATE KEY-----'],
  ['key body', `${'Q'.repeat(64)}
${'w'.repeat(64)}
${'e'.repeat(64)}
`],
  ['AWS access key', `const id = "AKIA${A(16)}"`],
  ['AWS secret key', `aws_secret_access_key = ${A(40, 'a')}`],
  ['API key (sk-)', `OPENAI_API_KEY=sk-${A(30, 'a')}`],
  ['API key (sk-)', `key: "sk-ant-${A(30, 'b')}"`],
  ['GitHub token', `token ghp_${A(36, 'a')}`],
  ['GitHub token', `github_pat_${A(30, 'a')}`],
  ['Slack token', `xoxb-${A(12, '1')}-${A(12, 'a')}`],
  ['Google API key', `AIza${A(35, 'a')}`],
  ['Stripe key', `sk_live_${A(20, 'a')}`],
  ['JSON web token', `eyJ${A(12, 'a')}.eyJ${A(12, 'b')}.${A(12, 'c')}`],
  ['password in a URL', 'postgres://admin:hunter2@db.internal:5432/app'],
  ['secret assigned in code', `const apiKey = "${A(24, 'q')}"`],
  ['secret assigned in code', `password: '${A(20, 'z')}'`],
  ['secret assigned in code', `"authToken": "${A(24, 'r')}"`]
]

test('each kind of secret is recognised and named, never repeated', () => {
  for (const [kind, text] of SECRETS) {
    assert.equal(findSecret(`before\n${text}\nafter`), kind, text.slice(0, 30))
  }
})

test('ordinary code is not held back', () => {
  const code = [
    'const token = process.env.API_TOKEN',
    "const password = ''",
    'password: "<your password>"',
    'apiKey = "${API_KEY}"',
    "token: 'changeme'",
    'import skLearn from "sk-learn"',
    'const id = "550e8400-e29b-41d4-a716-446655440000"',
    'const url = "https://example.com/path?x=1"',
    `const png = "data:image/png;base64,${'A'.repeat(200)}"`,
    `${'Q'.repeat(64)}
${'w'.repeat(64)}
const two = 1`,
    'const home = "http://user@host/path"',
    'function authToken(): string { return load() }',
    'const style = "background: url(data:image/png;base64,iVBORw0KGgo=)"'
  ]
  for (const line of code) {
    assert.equal(findSecret(line), null, line)
  }
})

test('placeholders in an assignment are not secrets, but a real-looking value next to them still is', () => {
  assert.equal(findSecret(`apiKey = "your_api_key_here_12345"`), null)
  assert.equal(findSecret(`apiKey = "${A(24, 'x')}"\nsecret = "${A(24, 'k')}"`), 'secret assigned in code')
})

const LINE = (c: string): string => c.repeat(64)
const BACKSLASH_N = `${String.fromCharCode(92)}n`

test('the body of a key is recognised however it is laid out in a file', () => {
  const lines = [LINE('Q'), LINE('w'), LINE('e')]
  const layouts: Record<string, string> = {
    'indented YAML block': `key: |\n${lines.map((l) => `    ${l}`).join('\n')}\n`,
    'quoted JSON array': `[\n${lines.map((l) => `  "${l}",`).join('\n')}\n]\n`,
    'single quotes, no comma': `${lines.map((l) => `'${l}'`).join('\n')}\n`,
    'Windows line ends': `${lines.join('\r\n')}\r\n`,
    'folded into one string with escaped line breaks': `"${lines.join(BACKSLASH_N)}${BACKSLASH_N}"`
  }
  for (const [name, text] of Object.entries(layouts)) {
    assert.equal(findSecret(text), 'key body', name)
  }
})

// Why: a lock file or a list of hashes is made of short lines and is not a key.
test('short or few lines of base64 are not taken for a key body', () => {
  assert.equal(findSecret(`${LINE('Q')}\n${LINE('w')}\nconst two = 1\n`), null)
  assert.equal(findSecret(`${'Q'.repeat(40)}\n${'w'.repeat(40)}\n${'e'.repeat(40)}\n`), null)
  assert.equal(findSecret(`    ${'Q'.repeat(64)}`), null)
})

test('a token the cursor sits inside is seen whole, though each side alone looks like nothing', () => {
  const before = `const key = "sk-${'a'.repeat(12)}`
  const after = `${'a'.repeat(12)}";`
  assert.equal(findSecret(before), null)
  assert.equal(findSecret(after), null)
  assert.equal(findSecretAround(before, after), 'API key (sk-)')
})

test('a secret in the name of the file is seen too', () => {
  assert.equal(findSecretAround('const a = 1', '', `sk-${'a'.repeat(30)}.ts`), 'API key (sk-)')
  assert.equal(findSecretAround('const a = 1', '', 'src/a.ts'), null)
})

test('findSecretAround still finds a secret on either side, and leaves ordinary code alone', () => {
  assert.equal(findSecretAround(`x = "ghp_${'a'.repeat(36)}"`, ''), 'GitHub token')
  assert.equal(findSecretAround('', `x = "ghp_${'a'.repeat(36)}"`), 'GitHub token')
  assert.equal(findSecretAround('const total = ', ';\nreturn total\n', 'src/a.ts'), null)
})
