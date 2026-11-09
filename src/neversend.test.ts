import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findSecret } from './neversend.ts'

// Built from pieces so this file does not itself look like it holds secrets.
const A = (n: number, c = 'A'): string => c.repeat(n)

const SECRETS: [string, string][] = [
  ['private key', `-----BEGIN ${'RSA '}PRIVATE KEY-----\nMIIE`],
  ['private key', `-----BEGIN ${'OPENSSH '}PRIVATE KEY-----`],
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
