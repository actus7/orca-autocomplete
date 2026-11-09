import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POSTFIX, expandPostfix, scanPostfix, unwrapParens } from './postfix.ts'

const scan = (text: string) => scanPostfix(text)

test('the expression before the dot is a name, a member chain, a call or an index access', () => {
  assert.deepEqual(scan('  ready.'), { start: 2, expression: 'ready', typed: '' })
  assert.deepEqual(scan('user.profile.admin.i'), { start: 0, expression: 'user.profile.admin', typed: 'i' })
  assert.deepEqual(scan('  items.filter(x => x.ok).le'), { start: 2, expression: 'items.filter(x => x.ok)', typed: 'le' })
  assert.deepEqual(scan('rows[i + 1].if'), { start: 0, expression: 'rows[i + 1]', typed: 'if' })
})

test('only the expression right before the dot is taken, not what comes before it in the line', () => {
  assert.deepEqual(scan('return a && b.'), { start: 12, expression: 'b', typed: '' })
  assert.deepEqual(scan('const x = (a && b).'), { start: 10, expression: '(a && b)', typed: '' })
})

test('nothing is offered for a number, a spread, a string, a comment or a dot with nothing before it', () => {
  assert.equal(scan('const x = 1.'), null)
  assert.equal(scan('f(...args.'), null)
  assert.equal(scan("const s = 'see user."), null)
  assert.equal(scan('const s = "a \\" b.'), null)
  assert.equal(scan('// the user.'), null)
  assert.equal(scan('# the user.'), null)
  assert.equal(scan('.'), null)
  assert.equal(scan('plain text'), null)
  assert.equal(scan('a.b c'), null, 'text after the dot that is not a word')
})

test('a quote that is closed again does not hide the expression after it', () => {
  assert.deepEqual(scan("log('x'); ready."), { start: 10, expression: 'ready', typed: '' })
})

test('parentheses that wrap the whole expression are dropped, others are kept', () => {
  assert.equal(unwrapParens('(a && b)'), 'a && b')
  assert.equal(unwrapParens('(a)(b)'), '(a)(b)')
  assert.equal(unwrapParens('f(a)'), 'f(a)')
  assert.equal(unwrapParens('((a))'), '(a)')
})

const template = (language: string, key: string) => POSTFIX[language].find((entry) => entry.key === key)!

test('a template wraps the expression', () => {
  assert.equal(expandPostfix(template('typescript', 'if'), 'ready'), 'if (ready) {\n\t$0\n}')
  assert.equal(expandPostfix(template('python', 'var'), 'load()'), '${1:name} = load()')
  assert.equal(expandPostfix(template('go', 'range'), 'rows'), 'for ${1:_}, ${2:v} := range rows {\n\t$0\n}')
})

test('if and not treat parentheses differently: if drops them, not keeps them so the negation covers it all', () => {
  assert.equal(expandPostfix(template('typescript', 'if'), '(a && b)'), 'if (a && b) {\n\t$0\n}')
  assert.equal(expandPostfix(template('typescript', 'not'), '(a && b)'), '!(a && b)')
  assert.equal(expandPostfix(template('python', 'not'), '(a and b)'), 'not (a and b)')
})

test('characters the snippet syntax would read are escaped in the expression', () => {
  assert.equal(expandPostfix(template('javascript', 'log'), '$el'), 'console.log(\\$el)')
  assert.equal(expandPostfix(template('javascript', 'log'), 'a}b'), 'console.log(a\\}b)')
  assert.equal(expandPostfix(template('javascript', 'log'), 'a\\b'), 'console.log(a\\\\b)')
})

test('every language has unique keys and each template uses the expression', () => {
  for (const [language, templates] of Object.entries(POSTFIX)) {
    assert.equal(new Set(templates.map((entry) => entry.key)).size, templates.length, `${language} repeats a key`)
    for (const entry of templates) {
      assert.ok(entry.body.includes('<expr>'), `${language}.${entry.key} never uses the expression`)
    }
  }
})
