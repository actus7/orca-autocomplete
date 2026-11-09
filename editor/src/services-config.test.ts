import assert from 'node:assert/strict'
import { test } from 'node:test'
import { looksLikeJsx, serviceModelName } from './services-config.ts'

test('looksLikeJsx recognises JSX elements and not generics or comparisons', () => {
  assert.equal(looksLikeJsx('return <div className="a">hi</div>'), true)
  assert.equal(looksLikeJsx('return <Button onClick={go} />'), true)
  assert.equal(looksLikeJsx('const x = <Props,>(p: Props) => p'), false)
  assert.equal(looksLikeJsx('if (a < b && c > d) {}'), false)
  assert.equal(looksLikeJsx('const list: Array<string> = []'), false)
})

test('serviceModelName picks the extension the language service needs', () => {
  assert.equal(serviceModelName('typescript', false), 'file:///untitled.ts')
  assert.equal(serviceModelName('typescript', true), 'file:///untitled.tsx')
  assert.equal(serviceModelName('javascript', false), 'file:///untitled.js')
  assert.equal(serviceModelName('javascript', true), 'file:///untitled.jsx')
})
