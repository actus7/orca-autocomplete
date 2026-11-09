// Measures a provider and model on code like yours: cuts places out of this repository's own files,
// asks for the rest of the line with the plugin's real request, and compares the answer with the code
// that was there. Run it before and after a change to see whether the change helped.
//
//   node bench/run.mjs --base-url http://localhost:11434/v1 --model qwen2.5-coder:1.5b --yes
//
// Options: --format openai|anthropic|ollama|mistral-fim (openai)  --key-env NAME (env var holding the key)  --samples N (40)
//          --seed N (1)  --timeout MS (6000)  --dir PATH (repeat; default src and editor/src)  --out FILE
//          --context graph  also tell the model what the code nearby calls in other files, read from the CodeGraph
//                           index of this repository (run `codegraph init` first; see bench/context.mjs)
// Compare two runs that used the same --seed and --samples with: node bench/compare.mjs a.json b.json
// It sends pieces of the files it reads to the provider you name, so a remote one needs --yes.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { complete } from '../src/complete.ts'
import { percentile } from '../src/metrics.ts'
import { openGraph, relatedFor } from './context.mjs'
import { looksPolluted, pickCuts, score } from './lib.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback)
const dirs = args.flatMap((arg, i) => (arg === '--dir' ? [args[i + 1]] : []))

const baseUrl = option('base-url', '')
const model = option('model', '')
if (!baseUrl || !model) {
  console.error('Need --base-url and --model. See the top of bench/run.mjs.')
  process.exit(2)
}
const host = new URL(baseUrl).hostname
if (!/^(localhost|127\.|\[?::1)/.test(host) && !args.includes('--yes')) {
  console.error(`This sends code from this repository to ${host}. Add --yes to go ahead.`)
  process.exit(2)
}

const provider = {
  format: option('format', 'openai'),
  baseUrl,
  model,
  apiKey: process.env[option('key-env', '')] ?? '',
  maxTokens: 96
}
const samples = Number(option('samples', '40'))
const timeoutMs = Number(option('timeout', '6000'))

function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === 'dist' || entry.name === 'node_modules' ? [] : collect(path)
    }
    return /\.(ts|tsx|mjs)$/.test(entry.name) && !/\.(test|generated)\./.test(entry.name) ? [{ path: relative(root, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }] : []
  })
}

const files = (dirs.length ? dirs : ['src', 'editor/src']).flatMap((dir) => collect(join(root, dir)))
const cuts = pickCuts(files, samples, Number(option('seed', '1')))
const graph = option('context', 'none') === 'graph' ? openGraph(option('db', join(root, '.codegraph', 'codegraph.db'))) : null
const results = []
for (const cut of cuts) {
  const related = graph ? relatedFor(graph, cut) : ''
  const startedAt = Date.now()
  try {
    const suggestion = await complete(provider, { path: cut.path, languageId: 'typescript', prefix: cut.prefix, suffix: cut.suffix, related }, AbortSignal.timeout(timeoutMs))
    results.push({ ...score(suggestion, cut.expected), polluted: looksPolluted(suggestion), ms: Date.now() - startedAt, relatedChars: related.length })
  } catch (error) {
    results.push({ error: error instanceof Error ? error.name : String(error), ms: Date.now() - startedAt, relatedChars: related.length })
  }
}

const answered = results.filter((r) => !r.error)
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0)
const summary = {
  model,
  host,
  samples: results.length,
  errors: results.length - answered.length,
  empty: answered.filter((r) => r.empty).length,
  polluted: answered.filter((r) => r.polluted).length,
  exact: `${Math.round((100 * answered.filter((r) => r.exact).length) / Math.max(1, results.length))}%`,
  similarity: mean(answered.map((r) => r.similarity)).toFixed(2),
  context: graph ? 'graph' : 'none',
  withContext: results.filter((r) => r.relatedChars > 0).length,
  p50: percentile(results.map((r) => r.ms), 50),
  p95: percentile(results.map((r) => r.ms), 95)
}
console.table([summary])
if (option('out', '')) {
  writeFileSync(option('out', ''), JSON.stringify({ summary, results }, null, 2))
}
