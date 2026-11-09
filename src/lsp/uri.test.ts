import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sameUri, uriKey } from './uri.ts'

test('the spellings a server may use for one Windows file are the same file', () => {
  assert.ok(sameUri('file:///E:/projetos/a.ts', 'file:///e%3A/projetos/a.ts'))
  assert.ok(sameUri('file:///E:/projetos/a.ts', 'file:///E%3a/Projetos/A.ts'))
  assert.ok(sameUri('file:///C:/Users/me/a%20b.ts', 'file:///c%3A/users/me/a b.ts'))
})

test('different files, and Unix paths that differ only in case, stay different', () => {
  assert.equal(sameUri('file:///E:/a.ts', 'file:///E:/b.ts'), false)
  assert.equal(sameUri('file:///home/me/A.ts', 'file:///home/me/a.ts'), false)
  assert.ok(sameUri('file:///home/me/a.ts', 'file:///home/me/a.ts'))
})

test('uriKey tolerates a malformed escape and a Windows separator', () => {
  assert.equal(uriKey('file:///home/me/%E0%A4%A'), '/home/me/%E0%A4%A')
  assert.equal(uriKey('file:///C:\\a\\b'), '/c:/a/b')
})
