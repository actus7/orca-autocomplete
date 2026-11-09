import assert from 'node:assert/strict'
import { test } from 'node:test'
import { looksLikeJsx, serviceModelName } from './services-config.ts'

test('looksLikeJsx recognises JSX elements and not generics or comparisons', () => {
  assert.equal(looksLikeJsx('return <div className="a">hi</div>'), true)
  assert.equal(looksLikeJsx('return <Button onClick={go} />'), true)
  assert.equal(looksLikeJsx('const x = <Props,>(p: Props) => p'), false)
  assert.equal(looksLikeJsx('if (a < b && c > d) {}'), false)
  assert.equal(looksLikeJsx('const list: Array<string> = []'), false)
  assert.equal(looksLikeJsx('return <>hi</>'), true)
})

// Why: reading these as TSX makes the language service report syntax errors in valid TypeScript.
test('looksLikeJsx leaves arrow generics and type assertions to plain TypeScript', () => {
  assert.equal(looksLikeJsx('export const identity = <T>(value: T): T => value'), false)
  assert.equal(looksLikeJsx('const el = <HTMLInputElement>document.getElementById("x")'), false)
  assert.equal(looksLikeJsx('function f<T>(x: Array<T>): Promise<T> { return Promise.resolve(x[0]) }'), false)
})

test('serviceModelName picks the extension the language service needs', () => {
  assert.equal(serviceModelName('typescript', false), 'file:///untitled.ts')
  assert.equal(serviceModelName('typescript', true), 'file:///untitled.tsx')
  assert.equal(serviceModelName('javascript', false), 'file:///untitled.js')
  assert.equal(serviceModelName('javascript', true), 'file:///untitled.jsx')
})
