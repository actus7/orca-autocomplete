import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectLanguage } from './detect.ts'

const cases: [string, string][] = [
  ['dockerfile', 'FROM node:22 AS build\nRUN npm ci\n'],
  ['dart', "import 'package:flutter/material.dart';\nvoid main() => runApp(App());\n"],
  ['elixir', 'defmodule Greeter do\n  def hello(name) do\n    name\n  end\nend\n'],
  ['clojure', '(ns app.core)\n(defn add [a b] (+ a b))\n'],
  ['hcl', 'resource "aws_s3_bucket" "logs" {\n  bucket = "x"\n}\n'],
  ['protobuf', 'syntax = "proto3";\nmessage User { string id = 1; }\n'],
  ['graphql', 'type User {\n  id: ID!\n}\n'],
  ['bat', '@echo off\nset NAME=world\n'],
  ['lua', 'local x = 1\nprint(x)\n'],
  ['perl', '#!/usr/bin/perl\nuse strict;\nmy $x = 1;\n'],
  ['powershell', 'param($Name)\nGet-ChildItem -Path $Name\n'],
  ['xml', '<?xml version="1.0"?>\n<root><a/></root>\n'],
  ['markdown', '# Title\n\nSome text\n'],
  ['yaml', 'name: app\nitems:\n  - one\n  - two\n'],
  ['scss', '.card {\n  color: red;\n}\n'],
  ['less', '@color: #333;\n.card { color: @color; }\n']
]

for (const [expected, text] of cases) {
  test(`detects ${expected} from its content`, () => {
    assert.equal(detectLanguage(text), expected)
  })
}

test('detectLanguage keeps empty or unrecognised text as plaintext', () => {
  assert.equal(detectLanguage(''), 'plaintext')
  assert.equal(detectLanguage('   \n  '), 'plaintext')
  assert.equal(detectLanguage('just some words here'), 'plaintext')
})

test('detectLanguage only reads the start of a long file', () => {
  const long = `${'x\n'.repeat(5000)}FROM node:22\n`
  assert.equal(detectLanguage(long), 'plaintext')
})
